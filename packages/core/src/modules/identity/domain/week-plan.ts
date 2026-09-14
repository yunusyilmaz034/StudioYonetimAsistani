import {
  addLocalDays,
  daysBetween,
  err,
  instant,
  instantFromLocalDate,
  ok,
  type DomainError,
  type Instant,
  type NewEvent,
  type Result,
  type StaffUserId,
} from '../../../shared'
import {
  STAFF_WEEK_PLAN_APPROVED,
  STAFF_WEEK_PLAN_DRAFT_SAVED,
  STAFF_WEEK_PLAN_RETURNED,
  STAFF_WEEK_PLAN_SUBMITTED,
  type LeaveKind,
  type StaffWeekPlanApprovedPayload,
} from '../events'
import type { DecideContext } from './decide'
import type { ShiftBlock, StaffLeave, StaffWeekPlan, WeekPlanEntries } from './types'

// ── HAFTALIK VARDİYA PLANI — kurallar (owner, 2026-09-14 · OR-77) ──────────────────────────
//
// Saf: I/O yok, saat yok. "Bugün" DIŞARIDAN gelir — geçmiş hafta kuralı sınanabilsin diye.
//
// Kurallar az ve hepsi burada:
//   · Günde TEK blok, 'HH:MM', çıkış girişten sonra. Gece yarısını geçen mesai yazılmaz.
//   · Geçmiş hafta yazılmaz, gönderilmez, onaylanmaz. Haftanın son günü (pazar) hâlâ bu haftadır.
//   · Taslağı resepsiyon ve owner düzenler; ONAYI ve GERİ GÖNDERMEYİ yalnızca owner verir.
//   · Yayındaki plana göre değişmemiş bir taslak onaya gönderilmez.
//   · Geri gönderme sebepsiz olmaz.
//   · İzinli güne vardiya yazmak REDDEDİLMEZ — uyarıdır (OR-77). Uyarının verisi `leaveDaysInWeek`.
//
// BİLEREK YOK (OR-72 ile aynı çit): fazla mesai hesabı, takas onay zinciri, puantaj, ceza.

const GUN = 86_400_000
/** 1970-01-05 bir pazartesiydi. Haftanın günü tarihten, `Date` olmadan hesaplanır. */
const BIR_PAZARTESI = '1970-01-05'
const SAAT = /^([01]\d|2[0-3]):([0-5]\d)$/
const TARIH = /^\d{4}-\d{2}-\d{2}$/

/** 'YYYY-MM-DD' günün haftasının pazartesisi. */
export function mondayOf(date: string): string {
  const gun = ((daysBetween(BIR_PAZARTESI, date) % 7) + 7) % 7
  return addLocalDays(date, -gun)
}

/** Pazartesiden pazara yedi gün. */
export function weekDates(weekStart: string): readonly string[] {
  return Array.from({ length: 7 }, (_, i) => addLocalDays(weekStart, i))
}

const dakika = (hhmm: string): number => {
  const m = SAAT.exec(hhmm)
  return m ? Number(m[1]) * 60 + Number(m[2]) : Number.NaN
}

const duzenleyebilir = (ctx: DecideContext) =>
  ctx.actor.type === 'owner' || ctx.actor.type === 'receptionist' || ctx.actor.type === 'platform_admin'
const onaylayabilir = (ctx: DecideContext) => ctx.actor.type === 'owner' || ctx.actor.type === 'platform_admin'

/** Haftanın son günü bugünden önceyse hafta geçmiştir. ISO tarihler metin olarak da sıralanır. */
const gecmis = (weekStart: string, today: string) => addLocalDays(weekStart, 6) < today

/** Anahtarları sıralı, boş personeli atılmış kopya. İki planın "aynı" olduğu buna bakılarak söylenir. */
function normalize(entries: WeekPlanEntries): WeekPlanEntries {
  const out: Record<string, Record<string, ShiftBlock>> = {}
  for (const sid of Object.keys(entries).sort()) {
    const gunler = entries[sid] ?? {}
    const tarihler = Object.keys(gunler).sort()
    if (tarihler.length === 0) continue
    out[sid] = Object.fromEntries(tarihler.map((d) => [d, { start: gunler[d]!.start, end: gunler[d]!.end }]))
  }
  return out
}

const esit = (a: WeekPlanEntries, b: WeekPlanEntries) => JSON.stringify(normalize(a)) === JSON.stringify(normalize(b))

function hucreler(e: WeekPlanEntries | null): Map<string, string> {
  const m = new Map<string, string>()
  for (const [sid, gunler] of Object.entries(e ?? {})) {
    for (const [d, b] of Object.entries(gunler)) m.set(`${sid}|${d}`, `${b.start}-${b.end}`)
  }
  return m
}

function sayim(e: WeekPlanEntries): { staffCount: number; blockCount: number } {
  const gunler = Object.values(e).map((g) => Object.keys(g).length)
  return { staffCount: gunler.filter((n) => n > 0).length, blockCount: gunler.reduce((a, n) => a + n, 0) }
}

/** Yayındakine göre değişen (personel, gün) hücresi: eklenen, silinen ya da saati değişen. */
function degisenGun(draft: WeekPlanEntries, published: WeekPlanEntries | null): number {
  const a = hucreler(draft)
  const b = hucreler(published)
  let n = 0
  for (const k of new Set([...a.keys(), ...b.keys()])) if (a.get(k) !== b.get(k)) n++
  return n
}

/** Planın biçimi ve günleri. Geçerliyse normalize edilmiş kopyayı döndürür. */
export function validateWeekPlanEntries(weekStart: string, entries: WeekPlanEntries): Result<WeekPlanEntries, DomainError> {
  if (!TARIH.test(weekStart) || instantFromLocalDate(weekStart, 0) === null || mondayOf(weekStart) !== weekStart) {
    return err({ code: 'week_plan_invalid' })
  }
  const hafta = new Set(weekDates(weekStart))
  for (const [sid, gunler] of Object.entries(entries)) {
    if (sid.trim() === '') return err({ code: 'week_plan_invalid' })
    for (const [d, b] of Object.entries(gunler)) {
      if (!hafta.has(d)) return err({ code: 'week_plan_invalid' })
      if (!SAAT.test(b.start) || !SAAT.test(b.end)) return err({ code: 'week_plan_invalid' })
      // Eşit saat de reddedilir: 09:00–09:00 bir mesai değil, bir yazım hatasıdır.
      if (dakika(b.end) <= dakika(b.start)) return err({ code: 'invalid_time_range' })
    }
  }
  return ok(normalize(entries))
}

const olay = (ctx: DecideContext, weekStart: string) => ({
  studioId: ctx.studioId,
  branchId: null,
  version: 1,
  occurredAt: ctx.now,
  actor: ctx.actor,
  source: ctx.source,
  subject: { kind: 'staffWeekPlan', id: weekStart } as const,
  related: {},
  policyRef: null,
  commandId: null,
  causationId: null,
  correlationId: ctx.correlationId,
})

const bos = (weekStart: string, ctx: DecideContext): StaffWeekPlan => ({
  weekStart,
  status: 'draft',
  draft: {},
  published: null,
  version: 0,
  returnReason: '',
  updatedAt: ctx.now,
  updatedBy: null,
  submittedAt: null,
  approvedAt: null,
  approvedBy: null,
})

type Karar = Result<{ next: StaffWeekPlan; events: NewEvent[] }, DomainError>

/** Taslağı kaydet. Onay bekleyen ya da yayındaki bir planı düzenlemek onu yeniden TASLAK yapar. */
export function decideSaveWeekPlanDraft(
  ctx: DecideContext,
  current: StaffWeekPlan | null,
  input: { readonly weekStart: string; readonly entries: WeekPlanEntries },
  today: string,
): Karar {
  if (!duzenleyebilir(ctx)) return err({ code: 'week_plan_editor_required' })
  const gecerli = validateWeekPlanEntries(input.weekStart, input.entries)
  if (!gecerli.ok) return gecerli
  if (gecmis(input.weekStart, today)) return err({ code: 'week_plan_past' })

  // Aynı taslağı ikinci kez kaydetmek bir eylem değildir; hiç planı olmayan haftaya boş kaydetmek de.
  if (current ? esit(current.draft, gecerli.value) : sayim(gecerli.value).blockCount === 0) {
    return ok({ next: current ?? bos(input.weekStart, ctx), events: [] })
  }

  const onceki = current ?? bos(input.weekStart, ctx)
  // Yayındakine geri dönüldüyse bekleyen değişiklik kalmamıştır: plan yeniden "yayında"dır.
  const yayindakiGibi = onceki.published !== null && esit(onceki.published, gecerli.value)
  const next: StaffWeekPlan = {
    ...onceki,
    draft: gecerli.value,
    status: yayindakiGibi ? 'published' : 'draft',
    returnReason: yayindakiGibi ? '' : onceki.returnReason,
    updatedAt: ctx.now,
    updatedBy: ctx.actor.id as StaffUserId,
  }
  return ok({
    next,
    events: [
      {
        ...olay(ctx, input.weekStart),
        type: STAFF_WEEK_PLAN_DRAFT_SAVED,
        payload: { weekStart: input.weekStart, ...sayim(gecerli.value) },
      },
    ],
  })
}

/** Onaya gönder. Çift tıklama ikinci bir olay yazmaz. */
export function decideSubmitWeekPlan(ctx: DecideContext, current: StaffWeekPlan | null, today: string): Karar {
  if (!duzenleyebilir(ctx)) return err({ code: 'week_plan_editor_required' })
  if (!current) return err({ code: 'week_plan_unchanged' })
  if (gecmis(current.weekStart, today)) return err({ code: 'week_plan_past' })
  if (current.status === 'submitted') return ok({ next: current, events: [] })
  if (current.published !== null && esit(current.draft, current.published)) return err({ code: 'week_plan_unchanged' })

  return ok({
    next: {
      ...current,
      status: 'submitted',
      returnReason: '',
      submittedAt: ctx.now,
      updatedAt: ctx.now,
      updatedBy: ctx.actor.id as StaffUserId,
    },
    events: [
      {
        ...olay(ctx, current.weekStart),
        type: STAFF_WEEK_PLAN_SUBMITTED,
        payload: {
          weekStart: current.weekStart,
          ...sayim(current.draft),
          changedDays: degisenGun(current.draft, current.published),
        },
      },
    ],
  })
}

/** Onayla: taslak YAYINA çıkar. Olay haftanın bütün saatlerini taşır — belge değişir, olay değişmez. */
export function decideApproveWeekPlan(ctx: DecideContext, current: StaffWeekPlan | null, today: string): Karar {
  if (!onaylayabilir(ctx)) return err({ code: 'week_plan_approver_required' })
  if (!current || current.status !== 'submitted') return err({ code: 'week_plan_not_submitted' })
  if (gecmis(current.weekStart, today)) return err({ code: 'week_plan_past' })

  const version = current.version + 1
  const blocks: StaffWeekPlanApprovedPayload['blocks'] = Object.entries(current.draft)
    .flatMap(([staffUserId, gunler]) => Object.entries(gunler).map(([date, b]) => ({ staffUserId, date, start: b.start, end: b.end })))
    .sort((a, b) => (a.date === b.date ? (a.staffUserId < b.staffUserId ? -1 : 1) : a.date < b.date ? -1 : 1))

  return ok({
    next: {
      ...current,
      status: 'published',
      published: current.draft,
      version,
      approvedAt: ctx.now,
      approvedBy: ctx.actor.id as StaffUserId,
      updatedAt: ctx.now,
      updatedBy: ctx.actor.id as StaffUserId,
    },
    events: [
      {
        ...olay(ctx, current.weekStart),
        type: STAFF_WEEK_PLAN_APPROVED,
        payload: { weekStart: current.weekStart, version, blocks },
      },
    ],
  })
}

/** Geri gönder: plan yeniden taslak olur, sebep resepsiyona görünür. Yayındaki plan DEĞİŞMEZ. */
export function decideReturnWeekPlan(ctx: DecideContext, current: StaffWeekPlan | null, reason: string): Karar {
  if (!onaylayabilir(ctx)) return err({ code: 'week_plan_approver_required' })
  if (!current || current.status !== 'submitted') return err({ code: 'week_plan_not_submitted' })
  const sebep = reason.trim()
  if (sebep === '') return err({ code: 'reason_required' })

  return ok({
    next: { ...current, status: 'draft', returnReason: sebep, updatedAt: ctx.now, updatedBy: ctx.actor.id as StaffUserId },
    events: [
      {
        ...olay(ctx, current.weekStart),
        type: STAFF_WEEK_PLAN_RETURNED,
        payload: { weekStart: current.weekStart, reason: sebep },
      },
    ],
  })
}

/**
 * Haftada kimin hangi gün ONAYLI izinli olduğu: personel → gün → izin türü.
 *
 * Bekleyen izin sayılmaz — henüz bir yokluk değil, bir istek. Plan ekranı bu veriyle "izinli güne
 * vardiya yazdın" uyarısını gösterir; karar vermek resepsiyonun ve owner'ın işidir.
 */
export function leaveDaysInWeek(
  weekStart: string,
  leaves: readonly StaffLeave[],
  utcOffsetMinutes: number,
): Readonly<Record<string, Readonly<Record<string, LeaveKind>>>> {
  const out: Record<string, Record<string, LeaveKind>> = {}
  for (const d of weekDates(weekStart)) {
    const bas = instantFromLocalDate(d, utcOffsetMinutes)
    if (bas === null) continue
    const son = (bas as number) + GUN - 1
    for (const l of leaves) {
      if (l.status !== 'approved') continue
      if ((l.from as number) <= son && (l.to as number) >= (bas as number)) {
        ;(out[String(l.staffUserId)] ??= {})[d] = l.kind
      }
    }
  }
  return out
}

export interface PlanVsActual {
  readonly plannedStart: Instant
  readonly plannedEnd: Instant
  /** İlk geçiş planlı girişten kaç dakika sonra. Erken gelen 0. Geçiş yoksa `null`. */
  readonly lateMinutes: number | null
  /** Son geçiş planlı çıkıştan kaç dakika önce. Geç kalan 0. Geçiş yoksa `null`. */
  readonly earlyMinutes: number | null
}

/**
 * Plan ile turnike yan yana (OR-77, karar 3). YALNIZCA GÖRÜNÜR: kesinti, ceza, puantaj yok.
 *
 * "Erken çıktı" ancak gün bittiğinde kesindir — gün içindeki son geçiş öğle arası olabilir. Bunu
 * söylemek çağıranın işi; burası yalnızca farkı hesaplar.
 */
export function planVsActual(
  date: string,
  block: ShiftBlock,
  firstCrossingAt: number | null,
  lastCrossingAt: number | null,
  utcOffsetMinutes: number,
): PlanVsActual | null {
  const gun = instantFromLocalDate(date, utcOffsetMinutes)
  const bas = dakika(block.start)
  const bit = dakika(block.end)
  if (gun === null || Number.isNaN(bas) || Number.isNaN(bit)) return null
  const plannedStart = instant((gun as number) + bas * 60_000)
  const plannedEnd = instant((gun as number) + bit * 60_000)
  return {
    plannedStart,
    plannedEnd,
    lateMinutes: firstCrossingAt === null ? null : Math.max(0, Math.floor((firstCrossingAt - plannedStart) / 60_000)),
    earlyMinutes: lastCrossingAt === null ? null : Math.max(0, Math.floor((plannedEnd - lastCrossingAt) / 60_000)),
  }
}
