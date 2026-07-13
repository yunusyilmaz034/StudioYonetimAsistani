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

    // v1.26 · AD-67 — and note the word: **anonimleştirildi**, not "silindi". It is the honest one.
    // Her record is still there, tombstoned, because her reservations and her payments still point
    // at it; what is gone is everything that said who she was. A screen that claimed "silindi" would
    // be describing a delete that did not happen, to a reader who would then wonder why the row is
    // still in the list.
    //
    // The member's NAME is deliberately absent from this sentence. It is an erasure: writing "Elif
    // Şahin anonimleştirildi" into a screen fed by the log would re-attach the name we just removed.
    case 'member.erased':
      return entry(`Üye kaydı ${erasureReasonText(str(p.reason))} anonimleştirildi.`, null, 'warning')

    case 'entitlement.purchased': {
      // The catalogue is data (AD-41), so the event carries the GRANT, not a product name —
      // the name lives in /products and would be a stale copy here. The sentence says what she
      // actually bought: how many classes, for how long, at what price.
      const grant = p.grant as { kind?: string; credits?: number; validForDays?: number } | undefined
      const what =
        grant?.kind === 'credits' ? `${grant.credits ?? 0} derslik paket` : 'süresiz üyelik'
      return entry(
        `${to(member)} ${what} tanımlandı.`,
        [
          grant?.validForDays ? `${grant.validForDays} gün geçerli` : null,
          p.priceAgreed !== undefined ? money(p.priceAgreed) : null,
        ]
          .filter(Boolean)
          .join(' · '),
        'success',
      )
    }
    case 'entitlement.payment_recorded':
      return entry(
        `${money(p.collectedAmount)} ödeme alındı.`,
        [methodTr(p.method), num(p.balanceDue) ? `kalan bakiye: ${money(p.balanceDue)}` : null]
          .filter(Boolean)
          .join(' · '),
        'success',
      )
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

    // ── finance (v1.24) ─────────────────────────────────────────────────────────────────
    case 'sale.created':
      return entry(
        `${to(member)} ${money(p.total)} tutarında satış yapıldı.`,
        [
          num(p.lineCount) ? `${num(p.lineCount)} kalem` : null,
          kurus(p.discountTotal) > 0 ? `${money(p.discountTotal)} indirim uygulandı` : null,
        ]
          .filter(Boolean)
          .join(' · '),
        'success',
      )
    case 'sale.cancelled':
      return entry(
        `${of_(member)} ${money(p.total)} tutarındaki satışı iptal edildi.`,
        str(p.reason),
        'warning',
      )
    case 'sale.settled':
      return entry(`${of_(member)} ${money(p.total)} tutarındaki satışı tamamen tahsil edildi.`, null, 'success')
    case 'payment.received':
      return entry(
        `${money(p.amount)} tahsilat alındı.`,
        [methodTr(p.method), str(p.drawerId) ? 'kasaya işlendi' : null].filter(Boolean).join(' · '),
        'success',
      )
    case 'payment.voided':
      return entry(
        `${money(p.amount)} tutarındaki tahsilat iptal edildi (void).`,
        str(p.reason),
        'danger',
      )
    case 'payment.refunded':
      return entry(`${money(p.amount)} iade edildi.`, [methodTr(p.method), str(p.reason)].filter(Boolean).join(' · '), 'warning')
    case 'allocation.applied':
      return entry(
        `${money(p.amount)} ödeme, satışa mahsup edildi.`,
        `kalan borç: ${money(p.saleBalanceAfter)}`,
        'default',
      )
    case 'drawer.opened':
      return entry(`Kasa açıldı.`, `açılış bakiyesi: ${money(p.openingFloat)}`, 'info')
    case 'drawer.closed': {
      const diff = kurus(p.discrepancy)
      return entry(
        'Kasa kapatıldı (gün sonu).',
        `beklenen ${money(p.expected)} · sayılan ${money(p.counted)}${diff === 0 ? ' · fark yok' : ''}`,
        diff === 0 ? 'success' : 'warning',
      )
    }
    case 'drawer.discrepancy_recorded': {
      const diff = kurus(p.discrepancy)
      return entry(
        `Kasa farkı: ${diff > 0 ? 'fazla' : 'açık'} ${money(p.discrepancy)}.`,
        str(p.note),
        'danger',
      )
    }
    case 'giftcard.issued':
      return entry(`${money(p.value)} değerinde hediye kartı oluşturuldu.`, null, 'default')
    case 'giftcard.redeemed':
      return entry(
        `Hediye kartından ${money(p.amount)} harcandı.`,
        `kalan: ${money(p.remainingAfter)}`,
        'default',
      )
    case 'coupon.created':
      return entry(
        `"${str(p.code) ?? 'Kupon'}" kuponu tanımlandı.`,
        p.kind === 'percent' ? `%${num(p.value) ?? 0} indirim` : `${money(money0(p.value))} indirim`,
        'default',
      )
    case 'coupon.redeemed':
      return entry(
        `"${str(p.code) ?? 'Kupon'}" kuponu kullanıldı.`,
        `${money(p.discount)} indirim`,
        'default',
      )
    case 'plan.created':
      return entry(
        `${of_(member)} borcu için ${num(p.instalmentCount) ?? 0} taksitli ödeme planı oluşturuldu.`,
        `toplam ${money(p.total)}`,
        'info',
      )
    case 'plan.instalment_paid':
      return entry(
        `${num(p.seq) ?? 0}. taksit ödendi.`,
        `${money(p.amount)} · kalan ${num(p.remainingInstalments) ?? 0} taksit`,
        'success',
      )
    case 'plan.cancelled':
      return entry('Ödeme planı iptal edildi.', str(p.reason), 'warning')

    // ── CRM (v1.24) ─────────────────────────────────────────────────────────────────────
    case 'lead.captured':
      return entry(
        `Yeni aday kaydı oluşturuldu.`,
        [sourceTr(p.source), str(p.sourceDetail)].filter(Boolean).join(' · '),
        'info',
      )
    case 'lead.stage_changed':
      return entry(
        `Aday ${stageTr(p.to)} aşamasına geçti.`,
        `${stageTr(p.from)} → ${stageTr(p.to)}`,
        'default',
      )
    case 'lead.lost':
      return entry(
        `Aday kaybedildi (${lostTr(p.reason)}).`,
        str(p.note),
        'warning',
      )
    case 'lead.converted':
      return entry(
        `Aday üyeye dönüştü.`,
        `${sourceTr(p.source)} · ${num(p.daysToConvert) ?? 0} günde`,
        'success',
      )
    case 'interaction.logged':
      return entry(
        `${interactionTr(p.kind)} kaydedildi.`,
        p.outcome === 'no_answer' ? 'Ulaşılamadı.' : p.outcome === 'callback' ? 'Geri aranacak.' : null,
        'default',
      )
    case 'offer.created':
      return entry(`${money(p.total)} tutarında teklif hazırlandı.`, null, 'default')
    case 'offer.sent':
      return entry(`${money(p.total)} tutarında teklif gönderildi.`, null, 'info')
    case 'offer.accepted':
      return entry(
        `Teklif kabul edildi — ${money(p.total)}.`,
        `${num(p.hoursToAccept) ?? 0} saatte karar verildi`,
        'success',
      )
    case 'offer.rejected':
      return entry(`Teklif reddedildi — ${money(p.total)}.`, str(p.reason), 'warning')
    case 'member.churned':
      return entry(
        `${member ?? 'Üye'} stüdyodan ayrıldı (${churnTr(p.reason)}).`,
        [str(p.note), num(p.membershipDays) ? `${num(p.membershipDays)} gün üyeydi` : null]
          .filter(Boolean)
          .join(' · '),
        'danger',
      )

    // ── notifications (v1.25). The log says THAT we tried, never WHAT we said (I-38). ────────
    case 'notification.intent_created':
      return entry(
        `${to(member)} bildirim hazırlandı.`,
        [templateTr(p.templateId), channelsTr(p.channels)].filter(Boolean).join(' · '),
        'default',
      )
    case 'notification.queued':
      return entry(`Bildirim kuyruğa alındı.`, channelTr(p.channel), 'default')
    case 'notification.sent':
      return entry(`Bildirim gönderildi.`, channelTr(p.channel), 'success')
    case 'notification.delivered':
      return entry(`Bildirim iletildi.`, channelTr(p.channel), 'success')
    case 'notification.failed':
      return entry(
        `Bildirim iletilemedi.`,
        [channelTr(p.channel), p.permanent === true ? 'kalıcı hata' : 'yeniden denenecek'].join(' · '),
        'danger',
      )
    case 'notification.suppressed':
      return entry(
        `Bildirim bilerek gönderilmedi.`,
        [channelTr(p.channel), suppressionTr(p.reason)].filter(Boolean).join(' · '),
        'warning',
      )
    case 'notification.retried':
      return entry(`Bildirim yeniden denendi.`, channelTr(p.channel), 'info')
    case 'entitlement.expiring':
      return entry(
        `${of_(member)} üyeliğinin bitmesine ${num(p.daysLeft) ?? 0} gün kaldı.`,
        str(p.productName),
        'warning',
      )
    case 'entitlement.credits_low':
      return entry(`${of_(member)} ${num(p.remaining) ?? 0} ders hakkı kaldı.`, null, 'warning')
    case 'system.operation_failed':
      return entry('Bir toplu işlem tamamlanamadı.', str(p.detail), 'danger')
    case 'system.error':
      return entry('Sistemde bir hata oluştu.', str(p.detail), 'danger')

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

const METHOD_TR: Record<string, string> = {
  cash: 'Nakit',
  credit_card: 'Kredi kartı',
  bank_transfer: 'Havale / EFT',
}
function methodTr(v: unknown): string | null {
  const m = str(v)
  return m ? (METHOD_TR[m] ?? m) : null
}

// Money in the log is `{ amount, currency }` (#10). Reading it as a number is how a revenue figure
// becomes a silent zero — the v1.23 lesson, applied once, in one place.
const kurus = (v: unknown): number => {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (v && typeof v === 'object' && 'amount' in v) {
    const a = (v as { amount: unknown }).amount
    return typeof a === 'number' ? a : 0
  }
  return 0
}
const money0 = (v: unknown): { amount: number } => ({ amount: num(v) ?? 0 })

const SOURCE_TR: Record<string, string> = {
  instagram: 'Instagram',
  walk_in: 'Kapıdan geldi',
  referral: 'Tavsiye',
  google: 'Google',
  phone: 'Telefon',
  event: 'Etkinlik',
  other: 'Diğer',
}
const STAGE_TR: Record<string, string> = {
  new: 'Yeni',
  contacted: 'İletişim kuruldu',
  trial: 'Deneme dersi',
  offer: 'Teklif',
  won: 'Kazanıldı',
  lost: 'Kaybedildi',
}
const LOST_TR: Record<string, string> = {
  price: 'fiyat',
  schedule: 'program uymadı',
  location: 'konum',
  competitor: 'rakibe gitti',
  not_interested: 'ilgilenmedi',
  unreachable: 'ulaşılamadı',
  other: 'diğer',
}
const CHURN_TR: Record<string, string> = {
  price: 'fiyat',
  schedule: 'program',
  moved_away: 'taşındı',
  injury: 'sakatlık',
  dissatisfied: 'memnun kalmadı',
  competitor: 'rakibe gitti',
  unknown: 'bilinmiyor',
}
const INTERACTION_TR: Record<string, string> = {
  call: 'Telefon görüşmesi',
  whatsapp: 'WhatsApp mesajı',
  sms: 'SMS',
  email: 'E-posta',
  meeting: 'Görüşme',
  note: 'Not',
  trial: 'Deneme dersi',
}
const lookup = (map: Record<string, string>, v: unknown, fallback = '—'): string => {
  const k = str(v)
  return k ? (map[k] ?? k) : fallback
}
const sourceTr = (v: unknown) => lookup(SOURCE_TR, v)
const stageTr = (v: unknown) => lookup(STAGE_TR, v)
const lostTr = (v: unknown) => lookup(LOST_TR, v, 'sebep belirtilmedi')
const churnTr = (v: unknown) => lookup(CHURN_TR, v, 'sebep belirtilmedi')
const interactionTr = (v: unknown) => lookup(INTERACTION_TR, v, 'Etkileşim')

const CHANNEL_TR: Record<string, string> = {
  in_app: 'uygulama içi',
  email: 'e-posta',
  sms: 'SMS',
  whatsapp: 'WhatsApp',
  push: 'push',
}
const SUPPRESSION_TR: Record<string, string> = {
  member_preference: 'üye tercihi',
  no_consent: 'rıza yok',
  daily_limit: 'günlük limit doldu',
  missing_contact: 'iletişim bilgisi yok',
  duplicate: 'tekrar',
}
const TEMPLATE_TR: Record<string, string> = {
  booking_confirmed: 'rezervasyon onayı',
  booking_cancelled: 'rezervasyon iptali',
  booking_moved: 'rezervasyon taşındı',
  session_cancelled: 'ders iptali',
  waitlist_promoted: 'bekleme listesi',
  closure_applied: 'kapanış duyurusu',
  package_created: 'yeni üyelik',
  package_expiring: 'üyelik bitiyor',
  credits_low: 'kredi azaldı',
  credits_exhausted: 'kredi bitti',
  payment_received: 'ödeme alındı',
  balance_reminder: 'bakiye hatırlatması',
  instalment_due: 'taksit hatırlatması',
  portal_invite: 'portal daveti',
  wallet_topup: 'cüzdan yüklemesi',
  alert_cash_discrepancy: 'kasa farkı uyarısı',
  alert_operation_failed: 'işlem hatası uyarısı',
  alert_system_error: 'sistem hatası uyarısı',
  alert_delivery_failed: 'iletilemeyen bildirim uyarısı',
}
const channelTr = (v: unknown): string => lookup(CHANNEL_TR, v, 'bilinmeyen kanal')
const suppressionTr = (v: unknown): string => lookup(SUPPRESSION_TR, v, 'sebep belirtilmedi')
const templateTr = (v: unknown): string => lookup(TEMPLATE_TR, v, 'bildirim')
const channelsTr = (v: unknown): string | null =>
  Array.isArray(v) && v.length > 0 ? v.map((c) => channelTr(c)).join(', ') : null

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

// The closed enum, in Turkish. A technical event name never reaches a screen (v1.22) — and neither
// does a technical enum value.
function erasureReasonText(reason: string | null): string {
  switch (reason) {
    case 'kvkk_request':
      return 'KVKK talebi nedeniyle'
    case 'legal_requirement':
      return 'yasal yükümlülük nedeniyle'
    case 'duplicate':
      return 'mükerrer kayıt nedeniyle'
    case 'test_data':
      return 'test verisi olduğu için'
    case 'owner_request':
      return 'stüdyo sahibinin talebiyle'
    default:
      return 'talep üzerine'
  }
}
