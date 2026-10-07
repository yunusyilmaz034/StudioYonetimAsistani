import {
  addLocalDays,
  DEFAULT_STUDIO_CONFIG,
  instant,
  instantFromLocalDate,
  localDateAt,
  newCorrelationId,
  newStaffBreakId,
  type DomainError,
  type EventSource,
  type Instant,
  type Result,
  type StaffUserId,
  type TenantContext,
} from '../../../shared'
import {
  decideCloseBreakWithShift,
  decideCorrectBreak,
  decideEndBreak,
  decideEnterBreakRetroactively,
  decideStartBreak,
  type RetroEntryWindow,
} from '../domain/break'
import { mondayOf } from '../domain/week-plan'
import type { StaffBreak, StaffShift } from '../domain/types'
import type { StaffBreakDeps, StaffShiftRepository } from './ports'

// ARA DİNLENMESİ — yükle, karar ver, tek işlemde yaz (owner, 2026-10-06/07).
//
// Mola vardiyanın İÇİNDEN düşülür: her işlem açık vardiyayı okur, çünkü vardiyası olmayan mola
// reddediliyor. Vardiya reposu ayrı bir bağımlılık olarak geçiyor — mola reposunun vardiyayı
// tanıması gerekmiyor, çağıran ikisini birlikte veriyor.

const SOURCE: EventSource = 'reception_web'

const dctx = (deps: StaffBreakDeps, ctx: TenantContext, source: EventSource = SOURCE) => ({
  studioId: ctx.studioId,
  actor: ctx.actor,
  now: deps.clock.now(),
  correlationId: newCorrelationId(),
  source,
})

const offsetOf = (deps: StaffBreakDeps): number =>
  deps.utcOffsetMinutes ?? DEFAULT_STUDIO_CONFIG.utcOffsetMinutes

/**
 * Geriye dönük giriş penceresi: içinde bulunulan haftanın PAZARTESİ 00:00'ından CUMARTESİ
 * 23:59:59.999'una (owner, 2026-10-07).
 *
 * Domain saat bilmediği için burada hesaplanıyor. Pazar dışarıda: o gün çizelge üretiliyor ve hafta
 * kapanıyor — kapanmış bir haftaya giriş yapılamaz.
 */
export function retroEntryWindow(now: Instant, utcOffsetMinutes: number): RetroEntryWindow {
  const pazartesi = mondayOf(localDateAt(now, utcOffsetMinutes) as string)
  const opensAt = instantFromLocalDate(pazartesi, utcOffsetMinutes)
  const pazar = instantFromLocalDate(addLocalDays(pazartesi, 6), utcOffsetMinutes)
  // Cumartesi gecesinin sonu = pazarın başlangıcından bir milisaniye önce.
  return { opensAt: instant(opensAt ?? (now as number)), closesAt: instant((pazar ?? (now as number)) - 1) }
}

export async function startBreak(
  deps: StaffBreakDeps,
  shiftRepo: StaffShiftRepository,
  ctx: TenantContext,
  input: { readonly staffUserId: StaffUserId },
): Promise<Result<{ breakId: string }, DomainError>> {
  const [acikVardiya, acikMola] = await Promise.all([
    shiftRepo.getOpenShift(ctx, input.staffUserId),
    deps.repo.getOpenBreak(ctx, input.staffUserId),
  ])
  const id = newStaffBreakId()
  const decided = decideStartBreak(
    dctx(deps, ctx),
    { staffUserId: input.staffUserId, shiftId: acikVardiya?.id ?? '', breakId: id },
    acikVardiya,
    acikMola,
  )
  if (!decided.ok) return decided

  const brk: StaffBreak = {
    id,
    staffUserId: input.staffUserId,
    shiftId: acikVardiya!.id,
    startedAt: deps.clock.now(),
    endedAt: null,
    source: 'live',
  }
  await deps.repo.saveBreak(ctx, brk, decided.value)
  return { ok: true, value: { breakId: id } }
}

export async function endBreak(
  deps: StaffBreakDeps,
  ctx: TenantContext,
  input: { readonly staffUserId: StaffUserId },
): Promise<Result<{ minutes: number }, DomainError>> {
  const acik = await deps.repo.getOpenBreak(ctx, input.staffUserId)
  const decided = decideEndBreak(dctx(deps, ctx), acik)
  if (!decided.ok) return decided
  await deps.repo.saveBreak(ctx, decided.value.next, decided.value.events)
  return { ok: true, value: { minutes: decided.value.events[0]!.payload.minutes } }
}

/**
 * Molaya basmayı unutan personel eksik molasını sonradan kendisi beyan eder.
 *
 * EKLEME, düzeltme değil: kaydedilmiş bir molaya dokunulmuyor. Pencere ve çakışma denetimi karar
 * fonksiyonunda; burada yalnızca girdiler toplanıyor.
 */
export async function enterBreakRetroactively(
  deps: StaffBreakDeps,
  shiftRepo: StaffShiftRepository,
  ctx: TenantContext,
  input: {
    readonly staffUserId: StaffUserId
    readonly shiftId: string
    readonly startedAt: Instant
    readonly endedAt: Instant
  },
): Promise<Result<{ breakId: string }, DomainError>> {
  const [vardiyalar, mevcut] = await Promise.all([
    shiftRepo.listShifts(ctx, (input.startedAt as number) - 86_400_000, (input.endedAt as number) + 86_400_000),
    deps.repo.listBreaksOfShift(ctx, input.shiftId),
  ])
  const vardiya = vardiyalar.find((v) => v.id === input.shiftId) ?? null
  const id = newStaffBreakId()
  const decided = decideEnterBreakRetroactively(
    dctx(deps, ctx),
    { ...input, breakId: id },
    vardiya,
    mevcut,
    retroEntryWindow(deps.clock.now(), offsetOf(deps)),
  )
  if (!decided.ok) return decided
  await deps.repo.saveBreak(ctx, decided.value.next, decided.value.events)
  return { ok: true, value: { breakId: id } }
}

/** Yönetici düzeltmesi: sebep zorunlu, öncesi/sonrası kayda geçer (§13). */
export async function correctBreak(
  deps: StaffBreakDeps,
  ctx: TenantContext,
  input: {
    readonly breakId: string
    readonly startedAt?: Instant
    readonly endedAt?: Instant | null
    readonly reason: string
  },
): Promise<Result<void, DomainError>> {
  const mola = await deps.repo.getBreak(ctx, input.breakId)
  if (!mola) return { ok: false, error: { code: 'no_open_break' } }
  const decided = decideCorrectBreak(
    dctx(deps, ctx),
    mola,
    { ...(input.startedAt !== undefined ? { startedAt: input.startedAt } : {}), ...(input.endedAt !== undefined ? { endedAt: input.endedAt } : {}) },
    input.reason,
  )
  if (!decided.ok) return decided
  // Değişen bir şey yoksa karar olay yazmadı — yazmaya da gerek yok.
  if (decided.value.events.length > 0) await deps.repo.saveBreak(ctx, decided.value.next, decided.value.events)
  return { ok: true, value: undefined }
}

/**
 * Gece işi: vardiya kapanırken açık kalan molayı da kapatır (owner kararı, 2026-10-07).
 *
 * Vardiya kapanışından AYRI bir kayıt, bilerek: iki farklı belge, ve her biri kendi olayıyla atomik
 * (#1). Vardiya işinin mola reposunu tanıması gerekmiyor; çağıran ikisini sırayla yürütüyor.
 */
export async function closeOpenBreakWithShift(
  deps: StaffBreakDeps,
  ctx: TenantContext,
  shift: StaffShift,
  closedAt: Instant,
): Promise<{ closed: number }> {
  const acik = await deps.repo.getOpenBreak(ctx, shift.staffUserId)
  if (!acik || acik.shiftId !== shift.id) return { closed: 0 }
  const decided = decideCloseBreakWithShift(dctx(deps, ctx, 'system_sweep'), acik, closedAt)
  if (!decided.ok) return { closed: 0 }
  await deps.repo.saveBreak(ctx, decided.value.next, decided.value.events)
  return { closed: 1 }
}
