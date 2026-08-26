import {
  clampOccurredAt,
  newCheckInId,
  type BranchId,
  type CommandId,
  type DomainError,
  type Instant,
  type MemberId,
  type Result,
  type TenantContext,
  instant,
} from '../../../shared'
import { decideConsumeEntry, entriesUsed } from '../../entitlements'
import { newCorrelationId } from '../../../shared'
import { decideCheckIn } from '../domain/decide'
import type { CheckInMethod, CheckInDirection } from '../domain/types'
import { decideContext } from './context'
import type { CheckinDeps } from './ports'

export interface RecordCheckInInput {
  readonly memberId: MemberId
  readonly branchId: BranchId
  readonly method: CheckInMethod
  readonly occurredAt: Instant // domain time (offline-mintable), clamped
  // null when NO command caused this — the online QR path (D16) is a Server Action, so there is
  // no command doc to point at. The envelope has always allowed a null causation; this type was
  // simply tighter than the truth.
  readonly commandId: CommandId | null
  /**
   * What the caller ASKED FOR. The QR paths leave it absent and keep the toggle — one code at the
   * door, in and out. Reception's labelled buttons set it, so pressing "Çıkış" twice is refused
   * instead of quietly putting her back inside.
   */
  readonly direction?: CheckInDirection
}

// Applied by `on-command-created` from a `checkIn.record` command (QR scan or manual
// pick). A toggle: outside → check in, inside → check out. Idempotent by construction
// (a redelivery re-reads the presence and produces the mirror state); the branch must
// be open (D3).
// The result carries the toggle DIRECTION and the check-in id, so a caller can react to a door ENTRY
// (e.g. spend a fitness serbest-giriş entry, v1.27) without re-deriving presence — a check-OUT never
// spends anything.
export interface RecordCheckInResult {
  readonly direction: 'in' | 'out'
  readonly checkInId: string
  /** Limitli fitness üyeliğinden giriş düşüldüyse, sonraki hâli. Düşmediyse `null`. */
  readonly fitnessEntry: { readonly used: number; readonly allowance: number } | null
}

/**
 * Bir KAPI GİRİŞİ, limitli fitness üyeliğinden bir giriş harcar (v1.27).
 *
 * BURADA, çünkü her kapı buradan geçiyor: QR, elle check-in, turnike. 2026-08-26'ya kadar bu kod
 * `qr.ts` içinde yaşıyordu ve diğer iki kapı onu çağırmıyordu — Işıl bunu haftalarca elle işaretlenen
 * bir üyenin sayacının sıfırda kalmasıyla buldu. Kural bir kapıya değil, odaya ait.
 *
 * YUMUŞAK: aşım kaydedilir, kapı asla reddedilmez. Kaç girişin kaldığını söylemek ekranın işi;
 * kimseyi dışarıda bırakmak bu fonksiyonun işi değil.
 */
async function consumeFitnessEntry(
  deps: CheckinDeps,
  ctx: TenantContext,
  memberId: MemberId,
  checkInId: string,
  direction: 'in' | 'out',
  now: Instant,
): Promise<RecordCheckInResult['fitnessEntry']> {
  if (direction !== 'in') return null
  const fitness = (await deps.entries.listActiveByMember(ctx, memberId)).filter(
    (e) => e.productSnapshot.category === 'fitness',
  )
  // Sınırsız fitness erişimi olan biri hiçbir şey harcamaz — sayaç ona ait değil.
  if (fitness.length === 0 || fitness.some((e) => (e.productSnapshot.entryAllowance ?? null) === null)) return null
  const target = [...fitness].sort(
    (a, b) => a.validUntil - b.validUntil || a.purchasedAt - b.purchasedAt || (a.id < b.id ? -1 : 1),
  )[0]
  if (!target) return null

  const decided = decideConsumeEntry(
    { studioId: ctx.studioId, actor: ctx.actor, now, correlationId: newCorrelationId(), source: 'door', commandId: null },
    target,
    checkInId,
  )
  if (!decided.ok) return null
  await deps.entries.saveEntitlement(ctx, decided.value.next, decided.value.events)
  return { used: entriesUsed(decided.value.next.entryLedger), allowance: target.productSnapshot.entryAllowance ?? 0 }
}

export async function recordCheckIn(
  deps: CheckinDeps,
  ctx: TenantContext,
  input: RecordCheckInInput,
): Promise<Result<RecordCheckInResult, DomainError>> {
  const now = deps.clock.now()
  const dctx = decideContext(deps, ctx, { now: clampOccurredAt(input.occurredAt, now), commandId: input.commandId })

  const [branch, presence, occupancy, recent] = await Promise.all([
    deps.repo.getBranch(ctx, input.branchId),
    deps.repo.getPresence(ctx, input.memberId),
    deps.repo.countPresence(ctx, input.branchId),
    // Her last crossing, for the double-press guard. A minute of history is all the decision needs,
    // and the query is bounded so it cannot grow into a scan of her whole year.
    deps.repo.listCheckInsByMember(ctx, input.memberId, instant(now - 5 * 60_000)),
  ])
  const lastCrossedAt = recent[0]?.occurredAt

  const decided = decideCheckIn(
    dctx,
    {
      checkInId: newCheckInId(),
      memberId: input.memberId,
      branchId: input.branchId,
      method: input.method,
      // Absent keys, not `undefined` — `exactOptionalPropertyTypes`.
      ...(input.direction !== undefined ? { direction: input.direction } : {}),
      ...(lastCrossedAt !== undefined ? { lastCrossedAt } : {}),
    },
    presence,
    occupancy,
    branch,
  )
  if (!decided.ok) return decided

  await deps.repo.applyCheckIn(
    ctx,
    input.memberId,
    decided.value.checkIn,
    decided.value.presenceNext,
    decided.value.events,
  )
  // Kapı yazıldıktan SONRA sayaç. Ayrı bir toplam, ayrı bir işlem — burada başarısızlık kapıyı
  // geri almaz, sadece sayaç eksik kalır ve mutabakat onu görür.
  const fitnessEntry = await consumeFitnessEntry(
    deps,
    ctx,
    input.memberId,
    decided.value.checkIn.id,
    decided.value.checkIn.direction,
    now,
  )
  return {
    ok: true,
    value: { direction: decided.value.checkIn.direction, checkInId: decided.value.checkIn.id, fitnessEntry },
  }
}
