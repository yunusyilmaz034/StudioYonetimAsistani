import {
  clampOccurredAt,
  newCheckInId,
  type BranchId,
  type CommandId,
  type DomainError,
  type Instant,
  type MemberId,
  type NewEvent,
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
 * Dersinden ne kadar önce gelirse hâlâ "derse geldi" sayılır.
 *
 * DEBT: bu bir eşik ve eşiklerin yeri policy, kod değil (#4 — "hiçbir şey altı sayısını bilmez").
 * Şimdilik sabit, çünkü owner kuralı gece verdi ve canlıda hatalı düşen giriş hakları var; policy
 * alanı eklemek şema kararı ve sabahı bekleyebilir. `docs/DEBT.md`'de kayıtlı.
 *
 * Bir saat: dersten önce üstünü değiştiren, ısınan, kahve içen üye hâlâ derse gelmiştir. Buse'nin
 * vakasında geliş 11:50, ders 17:00 — beş saat, yani doğru şekilde spor ziyareti sayılıyor.
 */
const EARLY_ARRIVAL_MS = 60 * 60_000

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

  // DERSİNE GELDİYSE SAYAÇ İŞLEMEZ (owner, 2026-08-26). Rezervasyon sorgusu KASTEN burada, fitness
  // kontrolünden sonra: sayacı olmayan üyeler için fazladan bir okuma yapmıyoruz, ki kapı hızlı
  // kalsın. Bkz. `ClassVisitLookup`.
  if (await deps.classes.hasClassAround(ctx, memberId, now, EARLY_ARRIVAL_MS)) return null

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

/**
 * Kararı verilmiş ama HENÜZ YAZILMAMIŞ bir check-in.
 *
 * `crossTurnstile` bunun için var: turnike kodu tek kullanımlık ve tüketimi bir işlem, ama check-in
 * reddedilebiliyor (çift okuma koruması, kapalı şube, dolu kapasite). Eskiden kod ÖNCE tükeniyordu;
 * check-in reddedilince geriye harcanmış bir kod, dönmüş bir kol ve hiç kayıt kalmıyordu — kapı
 * açılıyor, kimse geçmemiş görünüyordu. Sayımların sessizce kayması tam olarak böyle olur.
 *
 * Karar ile yazmayı ayırınca sıra düzeliyor: önce karar (yalnızca okur), sonra kodu tüket, sonra
 * yaz. Yarış da kapalı kalıyor, çünkü tüketim hâlâ tek bir işlem — iki telefon aynı kodu okutursa
 * biri kazanır, diğeri `qr_used` alır.
 */
export interface PreparedCheckIn {
  readonly checkIn: { readonly id: string; readonly direction: 'in' | 'out' }
  readonly presenceNext: Awaited<ReturnType<CheckinDeps['repo']['getPresence']>>
  readonly events: readonly NewEvent[]
  readonly memberId: MemberId
  readonly now: Instant
}

/** Yalnızca OKUR ve karar verir. Hiçbir şey yazmaz — reddedilirse geriye iz kalmaz. */
export async function prepareCheckIn(
  deps: CheckinDeps,
  ctx: TenantContext,
  input: RecordCheckInInput,
): Promise<Result<PreparedCheckIn, DomainError>> {
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

  return {
    ok: true,
    value: {
      checkIn: decided.value.checkIn,
      presenceNext: decided.value.presenceNext,
      events: decided.value.events,
      memberId: input.memberId,
      now,
    },
  }
}

/** Kararı YAZAR: kapı kaydı + presence + olaylar tek işlemde, sonra fitness sayacı. */
export async function commitCheckIn(
  deps: CheckinDeps,
  ctx: TenantContext,
  prepared: PreparedCheckIn,
): Promise<RecordCheckInResult> {
  await deps.repo.applyCheckIn(
    ctx,
    prepared.memberId,
    prepared.checkIn as never,
    prepared.presenceNext,
    prepared.events,
  )
  // Kapı yazıldıktan SONRA sayaç. Ayrı bir toplam, ayrı bir işlem — burada başarısızlık kapıyı
  // geri almaz, sadece sayaç eksik kalır ve mutabakat onu görür.
  const fitnessEntry = await consumeFitnessEntry(
    deps,
    ctx,
    prepared.memberId,
    prepared.checkIn.id,
    prepared.checkIn.direction,
    prepared.now,
  )
  return { direction: prepared.checkIn.direction, checkInId: prepared.checkIn.id, fitnessEntry }
}

export async function recordCheckIn(
  deps: CheckinDeps,
  ctx: TenantContext,
  input: RecordCheckInInput,
): Promise<Result<RecordCheckInResult, DomainError>> {
  const prepared = await prepareCheckIn(deps, ctx, input)
  if (!prepared.ok) return prepared
  return { ok: true, value: await commitCheckIn(deps, ctx, prepared.value) }
}
