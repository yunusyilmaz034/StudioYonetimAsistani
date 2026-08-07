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
import { recordCheckIn } from './checkin'

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
 * ORDER MATTERS HERE. The code is spent BEFORE the check-in is recorded, and that is deliberate: if
 * the two races, the failure we want is "the door did not open" — never "two people crossed on one
 * code". A spent code with no check-in behind it costs the member one rescan; the other way round
 * costs the studio a membership.
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

  // Spend it first — see the note above. `consumeTurnstileCode` is a transaction, so two phones on
  // the same screen in the same second produce one winner and one `qr_used`.
  const won = await deps.repo.consumeTurnstileCode(ctx, input.code, input.memberId, now)
  if (!won) return err({ code: 'qr_used' })

  const recorded = await recordCheckIn(deps, ctx, {
    memberId: input.memberId,
    branchId: decided.value.branchId,
    method: 'device',
    occurredAt: now,
    commandId: null,
    direction: decided.value.direction,
  })
  if (!recorded.ok) return recorded

  return ok({
    direction: recorded.value.direction,
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
