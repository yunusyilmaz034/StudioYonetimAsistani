import {
  instant,
  ok,
  err,
  type BranchId,
  type DeviceId,
  type DomainError,
  type Instant,
  type MemberId,
  type Result,
  type TenantContext,
} from '../../../shared'
import { decideOpenTurnstileManually, decideRedeemTurnstileCode } from '../domain/decide'
import type { TurnstileCode, TurnstileDirection } from '../domain/types'
import { decideContext } from './context'
import type { CheckinDeps } from './ports'
import { commitCheckIn, prepareCheckIn } from './checkin'

// ── TURNSTILE (v1.33) ────────────────────────────────────────────────────────────────────────
//
// The device shows a rotating code; the member scans it with her phone; the app asks us whether the
// arm may turn. Three things are worth knowing before touching this file.
//
// 1. IT PRODUCES `member.checked_in`, NOT A NEW EVENT. The architecture said so in 2026: "a reception
//    tap, a QR scan, and a 2027 turnstile all emit `member.checked_in` — `method` is metadata"
//    (AD-18). The producer never appears in the event type. `method: 'device'` has existed, unused,
//    since the first commit; today it starts being used.
//
// 2. THE DEVICE IS A PRINCIPAL (#5). It holds its own id and secret and the check-in carries
//    `actor: { type: 'device' }`. When the log says the door opened at 07:14 it names the door, not
//    whichever receptionist was signed in. This could not have been retrofitted.
//
// 3. THE SCREEN IS PUBLIC. Every rule in `decideRedeemTurnstileCode` exists because a code in a
//    corridor can be photographed: short life, single use, bound to one device.

/** How long a code on the screen is worth anything. Short enough that a photograph is useless. */
export const TURNSTILE_CODE_TTL_MS = 45_000

/**
 * Mint the next code for a device's screen.
 *
 * Called by the device itself, every few seconds. Six digits: the member scans it, so it never has
 * to be typed, but it stays short enough for a small screen to render legibly at a glance.
 *
 * `randomDigits` is passed IN rather than generated here — the domain layer forbids `Math.random`
 * for the reason it forbids clocks, and a code generator that cannot be seeded cannot be tested.
 */
export async function issueTurnstileCode(
  deps: CheckinDeps,
  ctx: TenantContext,
  deviceId: DeviceId,
  randomDigits: string,
): Promise<Result<{ code: string; expiresAt: Instant }, DomainError>> {
  const device = await deps.repo.getDevice(ctx, deviceId)
  if (!device || !device.active) return err({ code: 'qr_invalid' })

  const now = deps.clock.now()
  const code: TurnstileCode = {
    code: randomDigits,
    deviceId: device.id,
    studioId: ctx.studioId,
    branchId: device.branchId,
    issuedAt: now,
    expiresAt: instant(now + TURNSTILE_CODE_TTL_MS),
    usedBy: null,
    usedAt: null,
  }
  await deps.repo.saveTurnstileCode(ctx, code)
  // Touching `lastSeenAt` on every mint is what makes the panel's "is the door alive" honest: the
  // device asks for a code every few seconds, so silence means silence.
  await deps.repo.saveDevice(ctx, { ...device, lastSeenAt: now })
  return ok({ code: code.code, expiresAt: code.expiresAt })
}

export interface CrossTurnstileInput {
  readonly memberId: MemberId
  readonly code: string
  /** What the arm reported, when the direction wire is connected. `null` ⇒ infer from presence. */
  readonly reportedDirection: TurnstileDirection
}

export interface CrossTurnstileResult {
  readonly direction: 'in' | 'out'
  readonly deviceId: DeviceId
  readonly branchId: BranchId
}

/**
 * The member scanned the screen. May the arm turn?
 *
 * ORDER MATTERS HERE — and it changed on 2026-08-29.
 *
 * The code used to be spent BEFORE the check-in was decided, so that two phones on one screen could
 * never both win. But a check-in can be REFUSED — the double-scan guard, a closed branch, a full
 * room — and when it was, the code was already gone: the device saw `crossed`, the arm turned, the
 * screen said "Hoş geldin", and nothing was recorded. The member's app said the code was invalid
 * while the door stood open. A door that opens without a record is how occupancy drifts, quietly.
 *
 * The order is now: DECIDE (reads only) → spend the code → WRITE. A refusal now costs nothing: the
 * code is untouched, the arm does not move, and the member can simply scan again. The race is still
 * closed, because spending is still one transaction with one winner — two phones both pass the
 * decision, then exactly one of them consumes.
 *
 * The check-in itself goes through `recordCheckIn`, the same path reception and the kiosk use. One
 * arithmetic for occupancy, one debounce, one set of invariants — a second door into the same room,
 * never a second room.
 */
export async function crossTurnstile(
  deps: CheckinDeps,
  ctx: TenantContext,
  input: CrossTurnstileInput,
): Promise<Result<CrossTurnstileResult, DomainError>> {
  const now = deps.clock.now()
  const dctx = decideContext(deps, ctx, { now, commandId: null })

  const code = await deps.repo.getTurnstileCode(ctx, input.code)
  const device = code ? await deps.repo.getDevice(ctx, code.deviceId) : null
  const presence = await deps.repo.getPresence(ctx, input.memberId)

  const decided = decideRedeemTurnstileCode(dctx, {
    code,
    device,
    reportedDirection: input.reportedDirection,
    presence,
  })
  if (!decided.ok) return decided

  // ── 1. KARAR — yalnızca okur. Reddedilirse kod harcanmaz, kol dönmez.
  const prepared = await prepareCheckIn(deps, ctx, {
    memberId: input.memberId,
    branchId: decided.value.branchId,
    method: 'device',
    occurredAt: now,
    commandId: null,
    // HESAPLANAN YÖN KULLANILIYOR (2026-08-29). Buraya kadar `decideRedeemTurnstileCode` yönü
    // zaten belirledi: kolun raporu → ekranın tarafı → mevcut duruma bakarak çıkarım. Eskiden o
    // sonuç ATILIYOR, yalnızca `reportedDirection` geçiliyordu — o da null olduğu için `device.side`
    // hiç işe yaramıyordu ve yön yine tahminden çıkıyordu. Girişten okutan üye "çıkış yaptı"
    // görüyordu; kayıtlar `out → in → out → in` diye sırayla gidiyordu, çünkü tahmin ediliyordu.
    direction: decided.value.direction,
    // Ama koruma AÇIK kalıyor: ekranın tarafı bir olgu, bilinçli bir eylem değil. Kolun kendi teli
    // bağlandığında (o gerçekten bir bildirim) koruma kalkar.
    directionAsserted: input.reportedDirection !== null,
  })
  if (!prepared.ok) return prepared

  // ── 2. KODU TÜKET — tek işlem, tek kazanan. Aynı ekranı aynı saniyede okutan iki telefondan
  // biri geçer, diğeri `qr_used` alır.
  const won = await deps.repo.consumeTurnstileCode(ctx, input.code, input.memberId, now)
  if (!won) return err({ code: 'qr_used' })

  // ── 3. YAZ — bu noktadan sonra geçiş kesin: kod bizim, karar verilmiş.
  const recorded = await commitCheckIn(deps, ctx, prepared.value)

  return ok({
    direction: recorded.direction,
    deviceId: decided.value.deviceId,
    branchId: decided.value.branchId,
  })
}

/**
 * Reception opens the arm by hand — a guest, a Multisport visitor, a member whose phone is dead.
 *
 * It records NOTHING about a member, because there is no member: a guest crossing is not a check-in
 * and pretending otherwise would put a stranger into occupancy and into somebody's attendance. What
 * it does record is WHO opened it, which is the whole accountability of the feature.
 */
export async function openTurnstileManually(
  deps: CheckinDeps,
  ctx: TenantContext,
  deviceId: DeviceId,
  reason: string,
): Promise<Result<{ deviceId: DeviceId }, DomainError>> {
  const device = await deps.repo.getDevice(ctx, deviceId)
  if (!device || !device.active) return err({ code: 'qr_invalid' })

  const dctx = decideContext(deps, ctx, { now: deps.clock.now(), commandId: null })
  const decided = decideOpenTurnstileManually(dctx, deviceId, device.branchId, reason)
  if (!decided.ok) return decided

  // State and its event in ONE write (#1). The state here is the DEVICE — the branch's occupancy is
  // untouched, because nobody was identified and nobody entered.
  await deps.repo.saveDeviceWithEvents(ctx, { ...device, lastSeenAt: deps.clock.now() }, decided.value)
  return ok({ deviceId })
}
