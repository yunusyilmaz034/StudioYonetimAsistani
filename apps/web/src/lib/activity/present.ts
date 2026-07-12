import type { ActivityEvent, ActivityKind } from '@/server/activity-query'
import { formatDateTime } from '../datetime'

// ── THE PRESENTER (Doc 23 §2, owner rules 1 & 6, 2026-07-13). ───────────────────────────────
//
// **A technical event name never reaches the screen.** The person looking at this is not a
// developer: she is the owner at 21:15 asking who did what, or reception with a member standing in
// front of the desk saying "ben bunu iptal etmiştim". One glance, five seconds, an answer.
//
//   ❌ reservation.moved · payload {fromSessionId, toSessionId, withinWindow:false}
//   ✅ "Rezervasyon taşındı — Salı 09:00 → Perşembe 18:30 (gerekçe: üye aradı)"
//
// The layer is deliberately INDEPENDENT of the event types (owner rule 7): it takes a generic
// `ActivityEvent` and returns a generic `PresentedEntry`. Undo / Time Machine (v1.28) will render
// its own rows through this same function without importing a single event constant.
//
// A type with no sentence is a defect, not an empty row: `present()` never returns a raw type
// string — the fallback still produces Turkish, and `UNPRESENTED` lists what still needs a
// sentence, so a new event is caught by a test rather than by the owner.

export interface PresentedEntry {
  readonly title: string // the sentence — "Reyhan → Ayşe'ye Reformer 8 Ders üyeliği oluşturdu."
  readonly detail: string | null // the supporting line, when there is one
  readonly reason: string | null // OP-3 — always surfaced, never buried in a payload
  readonly kind: ActivityKind
  readonly tone: 'default' | 'success' | 'warning' | 'danger' | 'info'
}

const money = (kurus: unknown): string =>
  typeof kurus === 'number'
    ? `${(kurus / 100).toLocaleString('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ₺`
    : '—'

const dayTime = (ms: unknown): string =>
  typeof ms === 'number'
    ? new Date(ms).toLocaleString('tr-TR', {
        timeZone: 'Europe/Istanbul',
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—'

const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null)
const num = (v: unknown): number | null => (typeof v === 'number' ? v : null)

// The member's name, in the possessive form the sentence needs. Names come from /members — the
// event itself has none (#6).
const to = (name: string | null): string => (name ? `${name}’ye` : 'üyeye')
const of_ = (name: string | null): string => (name ? `${name}’nin` : 'üyenin')

const REASON_TR: Record<string, string> = {
  gift: 'hediye',
  correction: 'düzeltme',
  migration: 'aktarım',
  support: 'destek',
}

// The audit's "which fields changed" list, in Turkish. Values are NOT shown for a member profile
// edit — those values are the PII, and PII never enters the log (#6).
const FIELD_TR: Record<string, string> = {
  name: 'ad',
  fullName: 'ad soyad',
  phone: 'telefon',
  birthDate: 'doğum tarihi',
  notes: 'notlar',
  emergencyContact: 'acil durum kişisi',
  homeBranchId: 'şube',
  priceInKurus: 'fiyat',
  category: 'kategori',
  durationDays: 'süre (gün)',
  creditCount: 'ders adedi',
  active: 'durum',
  serviceIds: 'kapsanan dersler',
  description: 'açıklama',
  freezeAllowanceDays: 'dondurma hakkı',
  dailyReservationLimit: 'günlük rezervasyon limiti',
  cancellationAllowanceCount: 'iptal hakkı',
  capacity: 'kontenjan',
  type: 'tür',
}

export const fieldLabel = (f: string): string => FIELD_TR[f] ?? f

// The one formatter (owner rule 2): GG.AA.YYYY HH:mm:ss, everywhere, no milliseconds.
export const stamp = (e: ActivityEvent): string => formatDateTime(e.occurredAt)

export function present(e: ActivityEvent): PresentedEntry {
  const p = e.payload
  const member = e.memberName
  const kind = e.kind
  const reason = str(p.reason) ?? str(p.overrideReason) ?? null

  const entry = (
    title: string,
    detail: string | null = null,
    tone: PresentedEntry['tone'] = 'default',
  ): PresentedEntry => ({ title, detail, reason, kind, tone })

  switch (e.type) {
    // ── reservations ──────────────────────────────────────────────────────────────────────
    case 'reservation.booked':
      return entry(
        `${member ?? 'Üye'} için rezervasyon yapıldı.`,
        dayTime(p.sessionStartsAt),
        'success',
      )
    case 'reservation.cancelled':
      return entry(
        `${of_(member)} rezervasyonu iptal edildi.`,
        p.creditEffect === 'released' ? 'Kredi iade edildi.' : 'Kredi hareketi yok.',
        'warning',
      )
    case 'reservation.late_cancelled':
      return entry(
        `${of_(member)} rezervasyonu geç iptal edildi.`,
        p.creditEffect === 'consumed' ? 'Kredi yandı (geç iptal).' : 'Kredi iade edildi.',
        'danger',
      )
    case 'reservation.moved':
      return entry(
        `${of_(member)} rezervasyonu taşındı.`,
        `${dayTime(p.fromStartsAt)} → ${dayTime(p.toStartsAt)}${
          p.withinWindow === false ? ' · süre dışı taşıma' : ''
        }`,
        'info',
      )
    case 'reservation.attended':
      return entry(`${member ?? 'Üye'} derse katıldı.`, 'Eğitmen işaretledi.', 'success')
    case 'reservation.no_show':
      return entry(`${member ?? 'Üye'} derse gelmedi.`, 'Eğitmen işaretledi.', 'warning')
    case 'reservation.auto_resolved':
      return entry(
        `${of_(member)} rezervasyonu otomatik sonuçlandı.`,
        p.outcome === 'attended'
          ? 'Kimse iptal etmedi — katıldı sayıldı (stüdyo varsayılanı).'
          : 'Gelmedi sayıldı (stüdyo varsayılanı).',
        'default',
      )
    case 'reservation.corrected':
      return entry(
        `${of_(member)} yoklaması düzeltildi.`,
        `${statusTr(p.from)} → ${statusTr(p.to)}`,
        'info',
      )
    case 'reservation.note_set':
      return entry(`${of_(member)} rezervasyonuna not eklendi.`, str(p.text), 'default')

    // ── waitlist ─────────────────────────────────────────────────────────────────────────
    case 'waitlist.joined':
      return entry(
        `${member ?? 'Üye'} bekleme listesine eklendi.`,
        `${num(p.position) ?? '?'}. sırada · kredi ayrılmadı`,
        'info',
      )
    case 'waitlist.left':
      return entry(`${member ?? 'Üye'} bekleme listesinden çıktı.`, null, 'default')
    case 'waitlist.promoted':
      return entry(
        `${member ?? 'Üye'} bekleme listesinden rezervasyona geçirildi.`,
        `${num(p.waitedMinutes) ?? 0} dakika bekledi`,
        'success',
      )

    // ── membership & packages ────────────────────────────────────────────────────────────
    case 'member.registered':
      return entry(`${member ?? 'Yeni üye'} kaydedildi.`, null, 'success')
    case 'member.profile_updated':
      return entry(
        `${of_(member)} bilgileri güncellendi.`,
        fieldList(p.changedFields),
        'default',
      )
    case 'member.deactivated':
      return entry(`${member ?? 'Üye'} pasife alındı.`, null, 'warning')
    case 'member.invited':
      return entry(`${to(member)} üye portalı daveti gönderildi.`, null, 'default')
    case 'member.portal_activated':
      return entry(`${member ?? 'Üye'} portal hesabını aktifleştirdi.`, null, 'success')
    case 'member.portal_login':
      return entry(`${member ?? 'Üye'} portala giriş yaptı.`, null, 'default')

    case 'entitlement.purchased':
      return entry(
        `${to(member)} ${str(p.productName) ?? 'üyelik'} tanımlandı.`,
        [
          num(p.creditCount) !== null ? `${num(p.creditCount)} ders` : 'süresiz',
          p.priceAgreed !== undefined ? money(p.priceAgreed) : null,
        ]
          .filter(Boolean)
          .join(' · '),
        'success',
      )
    case 'entitlement.payment_recorded':
      return entry(`${money(p.amount)} ödeme alındı.`, str(p.method), 'success')
    case 'entitlement.credit_held':
      return entry(
        `${of_(member)} paketinden 1 kredi ayrıldı.`,
        available(p),
        'default',
      )
    case 'entitlement.credit_released':
      return entry(`${of_(member)} paketine 1 kredi iade edildi.`, available(p), 'success')
    case 'entitlement.credit_consumed':
      return entry(`${of_(member)} paketinden 1 kredi düşüldü.`, available(p), 'default')
    case 'entitlement.credit_restored':
      return entry(`${of_(member)} paketine kredi geri yüklendi.`, available(p), 'success')
    case 'entitlement.adjusted': {
      const delta = num(p.delta) ?? 0
      return entry(
        `${of_(member)} paketine ${delta > 0 ? `${delta} kredi eklendi` : `${Math.abs(delta)} kredi geri alındı`}.`,
        [reasonTr(p.reason), str(p.note), available(p)].filter(Boolean).join(' · '),
        delta > 0 ? 'success' : 'warning',
      )
    }
    case 'entitlement.extended':
      return entry(
        `${of_(member)} üyeliği ${num(p.days) ?? 0} gün uzatıldı.`,
        `${dateOnly(p.fromValidUntil)} → ${dateOnly(p.toValidUntil)}`,
        'success',
      )
    case 'entitlement.amended':
      return entry(`${of_(member)} paketi güncellendi.`, fieldList(p.changedFields), 'default')
    case 'entitlement.cancelled':
      return entry(`${of_(member)} paketi iptal edildi.`, null, 'warning')
    case 'entitlement.reactivated':
      return entry(`${of_(member)} paketi yeniden aktifleştirildi.`, null, 'success')
    case 'entitlement.exhausted':
      return entry(`${of_(member)} paketindeki krediler bitti.`, null, 'warning')
    case 'entitlement.expired':
      return entry(
        `${of_(member)} paketinin süresi doldu.`,
        num(p.expiredCredits) ? `${num(p.expiredCredits)} kredi kullanılmadan yandı` : null,
        'warning',
      )

    // ── check-in ─────────────────────────────────────────────────────────────────────────
    case 'member.checked_in':
      return entry(`${member ?? 'Üye'} stüdyoya giriş yaptı.`, str(p.method), 'success')
    case 'member.checked_out':
      return entry(`${member ?? 'Üye'} stüdyodan çıkış yaptı.`, null, 'default')
    case 'member.auto_checked_out':
      return entry(`${member ?? 'Üye'} otomatik çıkış yapıldı.`, 'Gün sonu kapanışı.', 'default')

    // ── operations ───────────────────────────────────────────────────────────────────────
    case 'studio_closure.planned':
      return entry(
        `"${str(p.reason) ?? 'Kapanış'}" kapanışı planlandı.`,
        `${dateOnly(p.dateFrom)} – ${dateOnly(p.dateTo)} · henüz uygulanmadı`,
        'info',
      )
    case 'studio_closure.applied':
      return entry(
        `"${str(p.reason) ?? 'Kapanış'}" operasyonu uygulandı.`,
        summaryLine([
          [num(p.sessionsCancelled), 'seans iptal edildi'],
          [num(p.reservationsReleased), 'rezervasyon iptal edildi'],
          [num(p.creditsReleased), 'kredi iade edildi'],
          [num(p.entitlementsExtended), 'paket uzatıldı'],
        ]),
        'warning',
      )
    case 'studio_closure.cancelled':
      return entry(`Kapanış planı iptal edildi.`, null, 'default')
    case 'bulk_operation.planned':
      return entry(`Toplu işlem planlandı.`, bulkAction(p), 'info')
    case 'bulk_operation.applied':
      return entry(
        `Toplu işlem uygulandı.`,
        [
          bulkAction(p),
          summaryLine([
            [num(p.entitlementsAffected), 'paket etkilendi'],
            [num(p.membersAffected), 'üye etkilendi'],
          ]),
        ]
          .filter(Boolean)
          .join(' · '),
        'warning',
      )
    case 'studio_calendar.day_marked':
      return entry(`Takvime "${str(p.title) ?? 'özel gün'}" işaretlendi.`, dayTypeTr(p.type), 'info')
    case 'studio_calendar.day_updated':
      return entry(`Takvim günü güncellendi.`, str(p.title), 'default')
    case 'studio_calendar.day_removed':
      return entry(`Takvim günü kaldırıldı.`, str(p.title), 'default')
    case 'studio_calendar.imported':
      return entry(
        `Resmî tatiller takvime aktarıldı.`,
        num(p.imported) !== null ? `${num(p.imported)} gün eklendi` : null,
        'info',
      )

    // ── schedule ─────────────────────────────────────────────────────────────────────────
    case 'class_session.scheduled':
      return entry(`${str(p.serviceName) ?? 'Seans'} oluşturuldu.`, dayTime(p.startsAt), 'default')
    case 'class_session.cancelled':
      return entry(`Seans iptal edildi.`, str(p.reason), 'danger')
    case 'class_session.capacity_changed':
      return entry(
        `Seans kontenjanı değiştirildi.`,
        `${num(p.from) ?? '?'} → ${num(p.to) ?? '?'} kişi`,
        'default',
      )
    case 'class_session.room_changed':
      return entry(`Seansın salonu değiştirildi.`, null, 'default')
    case 'class_session.trainer_changed':
      return entry(`Seansın eğitmeni değiştirildi.`, null, 'default')
    case 'class_session.assigned':
      return entry(`Özel ders bir üyeye ayrıldı.`, member, 'default')
    case 'class_session.note_set':
      return entry(`Seansa not eklendi.`, str(p.text), 'default')
    case 'class_template.created':
      return entry(`Haftalık ders şablonu oluşturuldu.`, null, 'default')
    case 'class_template.updated':
      return entry(`Haftalık ders şablonu güncellendi.`, null, 'default')
    case 'class_template.deactivated':
      return entry(`Haftalık ders şablonu kapatıldı.`, null, 'default')

    // ── catalogue, services, rooms, studio ───────────────────────────────────────────────
    case 'product.created':
      return entry(`"${str(p.name) ?? 'Paket'}" paketi oluşturuldu.`, money(p.priceInKurus), 'default')
    case 'product.updated':
      return entry(`Paket güncellendi.`, fieldList(p.changedFields), 'default')
    case 'service.created':
      return entry(`"${str(p.name) ?? 'Ders'}" dersi tanımlandı.`, null, 'default')
    case 'service.updated':
      return entry(`Ders güncellendi.`, fieldList(p.changedFields), 'default')
    case 'service.deactivated':
      return entry(`Ders kapatıldı.`, null, 'warning')
    case 'service.reactivated':
      return entry(`Ders yeniden açıldı.`, null, 'default')
    case 'service.policy_published':
      return entry(`Ders kuralları güncellendi.`, 'Yeni politika sürümü yayınlandı.', 'info')
    case 'room.created':
      return entry(`"${str(p.name) ?? 'Salon'}" salonu eklendi.`, null, 'default')
    case 'room.updated':
      return entry(`Salon güncellendi.`, fieldList(p.changedFields), 'default')
    case 'room.deactivated':
      return entry(`Salon kapatıldı.`, null, 'warning')
    case 'room.reactivated':
      return entry(`Salon yeniden açıldı.`, null, 'default')
    case 'branch.opened':
      return entry(`Şube açıldı.`, null, 'default')
    case 'branch.closed':
      return entry(`Şube kapatıldı.`, null, 'warning')
    case 'studio.settings_updated':
      return entry(`Stüdyo ayarları güncellendi.`, fieldList(p.changedFields), 'default')

    default:
      // Never a raw event name on screen. A new event type that reaches here is a defect the
      // presenter test catches (see present.test.ts) — but the owner still gets a sentence.
      return entry('Sistem kaydı oluşturuldu.', null, 'default')
  }
}

// Every event type the presenter has a real sentence for. The test asserts the catalogue and this
// list agree — that is what makes a forgotten sentence a failing build, not a blank row.
export const isPresented = (type: string): boolean => {
  const probe = present({
    type,
    payload: {},
    memberName: null,
    kind: 'system',
  } as ActivityEvent)
  return probe.title !== 'Sistem kaydı oluşturuldu.'
}

function available(p: Record<string, unknown>): string | null {
  const a = num(p.creditsAvailableAfter)
  return a === null ? null : `kalan: ${a} kredi`
}

function fieldList(v: unknown): string | null {
  if (!Array.isArray(v) || v.length === 0) return null
  return `${v.map((f) => fieldLabel(String(f))).join(', ')} güncellendi`
}

function reasonTr(v: unknown): string | null {
  const r = str(v)
  return r ? (REASON_TR[r] ?? r) : null
}

function statusTr(v: unknown): string {
  const map: Record<string, string> = {
    booked: 'rezerve',
    cancelled: 'iptal',
    late_cancelled: 'geç iptal',
    attended: 'katıldı',
    no_show: 'gelmedi',
  }
  const s = str(v)
  return s ? (map[s] ?? s) : '—'
}

function dayTypeTr(v: unknown): string | null {
  const map: Record<string, string> = {
    public_holiday: 'Resmî tatil',
    public_holiday_half: 'Yarım gün tatil',
    religious_holiday: 'Bayram',
    studio_closed: 'Stüdyo kapalı',
    maintenance: 'Bakım',
    trainer_training: 'Eğitmen eğitimi',
    special_event: 'Özel etkinlik',
    special_working_day: 'Özel çalışma günü',
  }
  const s = str(v)
  return s ? (map[s] ?? s) : null
}

function bulkAction(p: Record<string, unknown>): string | null {
  const action = p.action as { kind?: string; days?: number; credits?: number } | undefined
  if (!action) return null
  if (action.kind === 'extend_days') return `${action.days ?? 0} gün uzatma`
  if (action.kind === 'add_credits') return `${action.credits ?? 0} kredi ekleme`
  return null
}

function summaryLine(parts: readonly (readonly [number | null, string])[]): string | null {
  const out = parts.filter(([n]) => n !== null && n > 0).map(([n, label]) => `${n} ${label}`)
  return out.length > 0 ? out.join(' · ') : null
}

function dateOnly(v: unknown): string {
  if (typeof v === 'number') {
    return new Date(v).toLocaleDateString('tr-TR', {
      timeZone: 'Europe/Istanbul',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    })
  }
  return str(v) ?? '—'
}
