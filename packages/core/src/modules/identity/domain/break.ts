import {
  err,
  ok,
  type DomainError,
  type Instant,
  type NewEvent,
  type Result,
  type StaffUserId,
} from '../../../shared'
import {
  STAFF_BREAK_CORRECTED,
  STAFF_BREAK_ENDED,
  STAFF_BREAK_STARTED,
  type BreakSource,
  type StaffBreakCorrectedPayload,
  type StaffBreakEndedPayload,
  type StaffBreakStartedPayload,
} from '../events'
import { envelope, kendisi, type DecideContext } from './decide'
import type { StaffBreak, StaffShift } from './types'

// ── ARA DİNLENMESİ (owner, 2026-10-06/07) ───────────────────────────────────────────────────
//
// SAF: "şimdi", kimlik ve pencere hep dışarıdan gelir.
//
// Mola vardiyanın İÇİNDEN düşülür — bu yüzden her molanın bir `shiftId`si var ve vardiyası olmayan
// mola reddedilir (owner, 2026-10-07): neyden düşüleceği bilinmeyen bir süre, kayıt değil gürültüdür.
//
// Dakikalar AŞAĞI yuvarlanıyor, mevcut teamülle aynı: 59 saniye bir mola değildir.

const dk = (from: Instant, to: Instant): number =>
  Math.max(0, Math.floor(((to as number) - (from as number)) / 60_000))

/** Molayı DÜZELTEBİLENLER: patron ve resepsiyon (owner, 2026-10-06). Personelin kendisi DEĞİL. */
const duzeltebilir = (ctx: DecideContext): boolean =>
  ctx.actor.type === 'owner' || ctx.actor.type === 'receptionist' || ctx.actor.type === 'platform_admin'

export interface StartBreakInput {
  readonly staffUserId: StaffUserId
  readonly shiftId: string
  readonly breakId: string
}

/**
 * Molaya başla.
 *
 * `decideStartShift` ile aynı ret sırası: önce "senin mi", sonra durum. Açık vardiya YOKSA
 * reddediyoruz — owner'ın kararı (2026-10-07): molanın bağlanacağı vardiya ve düşüleceği çalışma
 * süresi yoksa kayıt yetim kalır.
 */
export function decideStartBreak(
  ctx: DecideContext,
  input: StartBreakInput,
  acikVardiya: StaffShift | null,
  acikMola: StaffBreak | null,
): Result<NewEvent<typeof STAFF_BREAK_STARTED, StaffBreakStartedPayload>[], DomainError> {
  if (!kendisi(ctx, input.staffUserId)) return err({ code: 'own_shift_only' })
  if (!acikVardiya || acikVardiya.endedAt !== null) return err({ code: 'no_open_shift' })
  if (acikVardiya.staffUserId !== input.staffUserId || acikVardiya.id !== input.shiftId) {
    return err({ code: 'own_shift_only' })
  }
  // İkinci bir açık mola, gün sonunda hangisinin gerçek olduğunu bilinemez yapar.
  if (acikMola) return err({ code: 'break_already_open' })
  return ok([
    {
      ...envelope(ctx, input.staffUserId),
      branchId: acikVardiya.branchId,
      type: STAFF_BREAK_STARTED,
      payload: { staffUserId: input.staffUserId as string, shiftId: input.shiftId, breakId: input.breakId },
    },
  ])
}

/**
 * Molayı bitir.
 *
 * Olay molanın KENDİ `source`'unu taşıyor: sonradan girilmiş bir molanın bitişi `live` görünmemeli
 * (#11). Molanın nasıl kaydedildiği, nasıl bittiğinden önce gelir.
 */
export function decideEndBreak(
  ctx: DecideContext,
  acikMola: StaffBreak | null,
): Result<{ next: StaffBreak; events: NewEvent<typeof STAFF_BREAK_ENDED, StaffBreakEndedPayload>[] }, DomainError> {
  if (!acikMola || acikMola.endedAt !== null) return err({ code: 'no_open_break' })
  if (!kendisi(ctx, acikMola.staffUserId)) return err({ code: 'own_shift_only' })
  return ok({
    next: { ...acikMola, endedAt: ctx.now },
    events: [
      {
        ...envelope(ctx, acikMola.staffUserId),
        type: STAFF_BREAK_ENDED,
        payload: {
          staffUserId: acikMola.staffUserId as string,
          shiftId: acikMola.shiftId,
          breakId: acikMola.id,
          minutes: dk(acikMola.startedAt, ctx.now),
          source: acikMola.source,
        },
      },
    ],
  })
}

/** Geriye dönük giriş penceresi — çağıran haftadan hesaplar, domain saat bilmez. */
export interface RetroEntryWindow {
  readonly opensAt: Instant
  readonly closesAt: Instant
}

export interface RetroBreakInput {
  readonly staffUserId: StaffUserId
  readonly shiftId: string
  readonly breakId: string
  readonly startedAt: Instant
  readonly endedAt: Instant
}

/**
 * Molaya basmayı unutan personel, eksik molasını SONRADAN kendisi beyan eder (owner, 2026-10-07).
 *
 * Pencere: pazartesi–cumartesi 23:59, yalnızca o hafta. Pazar çizelge üretilir ve hafta kapanır.
 * Yalnızca KENDİSİ girebilir — başkasının molası hakkındaki beyan, başka bir şeydir.
 *
 * `source: 'retro_entry'` ve bu bir süsleme değil: EKLEME yapılıyor, DÜZELTME yapılmıyor. Kaydedilmiş
 * bir molayı personel değiştiremez ve silemez; §13 böyle korunuyor. Beyan ile gözlem arasındaki fark
 * da kayıtta sonsuza kadar duruyor (#11).
 */
export function decideEnterBreakRetroactively(
  ctx: DecideContext,
  input: RetroBreakInput,
  vardiya: StaffShift | null,
  mevcutMolalar: readonly StaffBreak[],
  pencere: RetroEntryWindow,
): Result<
  { next: StaffBreak; events: readonly NewEvent[] },
  DomainError
> {
  if (!kendisi(ctx, input.staffUserId)) return err({ code: 'own_shift_only' })
  if (!vardiya || vardiya.id !== input.shiftId || vardiya.staffUserId !== input.staffUserId) {
    return err({ code: 'no_open_shift' })
  }
  if (ctx.now < pencere.opensAt || ctx.now > pencere.closesAt) return err({ code: 'retro_entry_window_closed' })
  if (input.startedAt < pencere.opensAt || input.startedAt > pencere.closesAt) {
    return err({ code: 'retro_entry_window_closed' })
  }
  if ((input.endedAt as number) <= (input.startedAt as number)) return err({ code: 'invalid_time_range' })
  // Mola vardiyanın içinde olmalı: dışına taşan bir mola, olmayan bir çalışmadan düşülürdü.
  if (input.startedAt < vardiya.startedAt) return err({ code: 'invalid_time_range' })
  const vardiyaBitis = vardiya.endedAt ?? vardiya.lastCrossingAt
  if (vardiyaBitis !== null && input.endedAt > vardiyaBitis) return err({ code: 'invalid_time_range' })
  const cakisiyor = mevcutMolalar.some((m) => {
    const son = m.endedAt ?? ctx.now
    return input.startedAt < son && (m.startedAt as number) < (input.endedAt as number)
  })
  if (cakisiyor) return err({ code: 'break_overlaps' })

  const next: StaffBreak = {
    id: input.breakId,
    staffUserId: input.staffUserId,
    shiftId: input.shiftId,
    startedAt: input.startedAt,
    endedAt: input.endedAt,
    source: 'retro_entry',
  }
  // İKİ olay: başladı ve bitti. `occurredAt` beyan edilen saatlerdir, beyanın yapıldığı an değil —
  // olayın zamanı gerçeğin zamanıdır, kaydın zamanı `recordedAt`tir (D2).
  return ok({
    next,
    events: [
      {
        ...envelope(ctx, input.staffUserId),
        occurredAt: input.startedAt,
        branchId: vardiya.branchId,
        type: STAFF_BREAK_STARTED,
        payload: { staffUserId: input.staffUserId as string, shiftId: input.shiftId, breakId: input.breakId },
      },
      {
        ...envelope(ctx, input.staffUserId),
        occurredAt: input.endedAt,
        branchId: vardiya.branchId,
        type: STAFF_BREAK_ENDED,
        payload: {
          staffUserId: input.staffUserId as string,
          shiftId: input.shiftId,
          breakId: input.breakId,
          minutes: dk(input.startedAt, input.endedAt),
          source: 'retro_entry' as BreakSource,
        },
      },
    ],
  })
}

/**
 * 23:00'te vardiya kapanırken açık kalan molayı kapatır (owner kararı, 2026-10-07).
 *
 * `source: 'auto_closed'` — gözlenmiş bir bitiş YOK. `system` gözlemediğini gözlemiş gibi yazamaz
 * (#11); bu yüzden kapatma gizlenmiyor, adıyla işaretleniyor ve raporda ayrı görünüyor.
 */
export function decideCloseBreakWithShift(
  ctx: DecideContext,
  mola: StaffBreak,
  kapanisAni: Instant,
): Result<{ next: StaffBreak; events: readonly NewEvent[] }, DomainError> {
  if (mola.endedAt !== null) return err({ code: 'no_open_break' })
  if (ctx.actor.type !== 'system' && !kendisi(ctx, mola.staffUserId)) return err({ code: 'own_shift_only' })
  const bitis = kapanisAni < mola.startedAt ? mola.startedAt : kapanisAni
  return ok({
    next: { ...mola, endedAt: bitis, source: 'auto_closed' },
    events: [
      {
        ...envelope(ctx, mola.staffUserId),
        occurredAt: bitis,
        type: STAFF_BREAK_ENDED,
        payload: {
          staffUserId: mola.staffUserId as string,
          shiftId: mola.shiftId,
          breakId: mola.id,
          minutes: dk(mola.startedAt, bitis),
          source: 'auto_closed' as BreakSource,
        },
      },
    ],
  })
}

/**
 * Yönetici düzeltmesi: öncesi, sonrası, kim ve NEDEN (owner §13).
 *
 * Patron ve resepsiyon yapar; personel kendi geçmiş molasını değiştiremez. Hiçbir şey değişmiyorsa
 * olay yazılmaz — aynı değer bir düzeltme değildir (`decideChangeRole`in aynı deseni).
 */
export function decideCorrectBreak(
  ctx: DecideContext,
  mola: StaffBreak,
  yeni: { readonly startedAt?: Instant; readonly endedAt?: Instant | null },
  reason: string,
): Result<
  { next: StaffBreak; events: NewEvent<typeof STAFF_BREAK_CORRECTED, StaffBreakCorrectedPayload>[] },
  DomainError
> {
  if (!duzeltebilir(ctx)) return err({ code: 'break_correction_forbidden' })
  if (reason.trim().length === 0) return err({ code: 'reason_required' })

  const next: StaffBreak = {
    ...mola,
    startedAt: yeni.startedAt ?? mola.startedAt,
    endedAt: yeni.endedAt === undefined ? mola.endedAt : yeni.endedAt,
  }
  if (next.endedAt !== null && (next.endedAt as number) <= (next.startedAt as number)) {
    return err({ code: 'invalid_time_range' })
  }

  const changes: Record<string, { from: unknown; to: unknown }> = {}
  if ((next.startedAt as number) !== (mola.startedAt as number)) {
    changes.startedAt = { from: mola.startedAt as number, to: next.startedAt as number }
  }
  if ((next.endedAt as number | null) !== (mola.endedAt as number | null)) {
    changes.endedAt = { from: mola.endedAt as number | null, to: next.endedAt as number | null }
  }
  const changedFields = Object.keys(changes)
  if (changedFields.length === 0) return ok({ next: mola, events: [] })

  return ok({
    next,
    events: [
      {
        ...envelope(ctx, mola.staffUserId),
        type: STAFF_BREAK_CORRECTED,
        payload: {
          breakId: mola.id,
          staffUserId: mola.staffUserId as string,
          changedFields,
          changes,
          reason: reason.trim(),
        },
      },
    ],
  })
}
