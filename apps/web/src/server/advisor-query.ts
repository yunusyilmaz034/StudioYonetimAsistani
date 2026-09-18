import {
  DEFAULT_INSIGHT_CONFIG,
  deriveInsights,
  FirestoreCheckinRepository,
  FirestoreReservationRepository,
  type BranchId,
  type Insight,
  type InsightFacts,
  type InsightSeverity,
  type InsightKind,
  type MemberId,
} from '@studio/core'
import type { TenantContext } from '@studio/core'

import { formatDateTime } from '@/lib/datetime'
import { adminDb } from './firebase-admin'

import { formatKurus } from '@/lib/payroll-labels'

import { listFollowUps } from './follow-ups'
import { loadOwnerDashboard, type OwnerDashboard } from './owner-dashboard'

// AI Insights L1 — the advisor's read. It maps the owner dashboard (a single bounded read; NO new
// heavy queries) into the PII-free `InsightFacts` the pure `deriveInsights` consumes, then resolves
// each ranked insight back into a display item with a name and a deep link to an EXISTING tool. The
// advisor suggests; it never acts.

export interface AdvisorItem {
  readonly id: string
  // Two kinds live outside the insight engine on purpose: neither is derived from the dashboard's
  // facts, and neither is a problem to be solved. 'hot_lead' is a WhatsApp conversation worth
  // answering; 'online_payment' is money that already arrived by card.
  // 'door_refused' de dışarıdan: pano okuma modelinden değil, olay kaydından geliyor.
  // 'staff_leave' — eğitmensiz kalan dersler ve karar bekleyen izinler. Pano okuma modelinden
  // değil, izin kayıtlarından geliyor.
  // 'staff_plan' — haftalık vardiya planının EKSİĞİ (OR-77): onaylanmamış hafta, gönderilmemiş plan.
  readonly kind: InsightKind | 'hot_lead' | 'online_payment' | 'door_refused' | 'staff_leave' | 'staff_plan'
  readonly severity: InsightSeverity
  readonly title: string
  readonly detail: string
  readonly href: string
  readonly actionLabel: string
  // The resolved subject (member/session) name — kept SEPARATE so the AI narrator can tokenise it out
  // and no PII reaches the model. null when there is no named subject.
  readonly subject: { readonly id: string; readonly name: string } | null
  // GRUBUN özeti, satırın değil (owner, 2026-09-01). Bir günün toplamı bir satıra yazılınca göz onu
  // o satıra ait sanıyor: 5.000 ₺'lik bir tahsilatın sonunda "toplam 19.000 ₺" yazması, 19 bin
  // çekilmiş gibi okunuyordu. Aynı `kind`'daki satırların hepsi aynı notu taşır; ekran bir kez,
  // listenin altında yazar.
  readonly groupNote?: string
  // TAKİP NOTU (owner, 2026-09-18) — *"ödeme yapacak şu gün falan diye, ya da iptal edecek."* Satırın
  // altında görünür ve borç kapanana kadar durur. `dueAt` geçmemişse satır listeye hiç girmez:
  // "22'sinde ödeyecek" diyen birini 19'unda tekrar aramak tahsilat değil, taciz.
  readonly followUp?: { readonly note: string; readonly byName: string; readonly dueAt: number | null; readonly kind: string }
}

function present(
  insight: Insight,
  memberName: Map<string, string>,
  sessionName: Map<string, string>,
  upcoming: ReadonlyMap<string, string>,
  inside: ReadonlySet<string>,
  followUps: ReadonlyMap<string, { note: string; byName: string; dueAt: number | null; kind: string }> = new Map(),
): AdvisorItem {
  const m = insight.metrics
  const memberId = insight.refs.memberId
  const name = (memberId && memberName.get(memberId)) || (insight.refs.sessionId && sessionName.get(insight.refs.sessionId)) || 'Bilinmeyen'
  const memberHref = memberId ? `/members/${memberId}` : '/members'
  const subjectId = memberId ?? insight.refs.sessionId ?? null
  const subject = subjectId ? { id: subjectId, name } : null

  switch (insight.kind) {
    case 'outstanding_balance': {
      // BİR HAFTAYI GEÇEN BORÇ, RESEPSİYONUN İŞİDİR (owner, 2026-09-16). Satır artık üyenin YAKLAŞAN dersini de
      // söylüyor: *"pilates rezervasyonu varsa şu gün şu saatte gelecek, resepsiyon tahsilata baksın."* Ders bilgisi
      // okuma anında rezervasyonlardan geliyor; içgörü kuralı PII taşımaz (#6), cümle burada kuruluyor.
      const gun = m.daysOpen ?? 0
      const ders = upcoming.get(memberId ?? '')
      const icerde = inside.has(memberId ?? '')
      const takip = memberId ? followUps.get(memberId) : undefined
      return {
        id: insight.id,
        kind: insight.kind,
        severity: insight.severity,
        subject,
        ...(takip ? { followUp: takip } : {}),
        title: `${name} — ${formatKurus(m.dueKurus ?? 0)} açık bakiye`,
        detail: [
          `${gun} gündür ödenmedi.`,
          icerde ? 'ŞU AN İÇERİDE — tahsilat için uygunluğunu sorun.' : ders ? `${ders} dersine gelecek; o gün tahsilata bakın.` : null,
          !icerde && !ders ? 'Tahsilat için üyeyi açın.' : null,
        ]
          .filter(Boolean)
          .join(' '),
        href: memberHref,
        actionLabel: 'Tahsilat / üyeyi aç',
      }
    }
    case 'expiring_with_credits': {
      // The line says the number of lessons FIRST, because that is the part with a deadline. A
      // renewal can happen next week; these credits cannot.
      const d = m.daysLeft ?? 0
      const left = m.remaining ?? 0
      return {
        id: insight.id,
        kind: insight.kind,
        severity: insight.severity,
        subject,
        title: `${name} — ${left} ders hakkı var, paketi ${d <= 0 ? 'bugün doluyor' : `${d} gün sonra doluyor`}`,
        detail:
          'Kullanılmayan haklar paket dolunca yanar. Bu hafta gelebileceği bir ders ayarlayın — ' +
          'süre gerçekten yetmiyorsa paketin bitiş tarihini uzatabilirsiniz.',
        href: memberHref,
        actionLabel: 'Üyeyi aç',
      }
    }
    case 'expiring_soon': {
      const d = m.daysLeft ?? 0
      return {
        id: insight.id,
        kind: insight.kind,
        severity: insight.severity,
        subject,
        title: `${name} — paketi ${d <= 0 ? 'bugün doluyor' : `${d} gün sonra doluyor`}`,
        detail: 'Yenileme için üyeyle iletişime geçin.',
        href: memberHref,
        actionLabel: 'Üyeyi aç',
      }
    }
    case 'low_credit':
      return {
        id: insight.id,
        kind: insight.kind,
        severity: insight.severity,
        subject,
        title: `${name} — ${m.remaining ?? 0} ders hakkı kaldı`,
        detail: 'Yenileme fırsatı — üyeye yeni paket önerin.',
        href: memberHref,
        actionLabel: 'Üyeyi aç',
      }
    case 'empty_session':
      return {
        id: insight.id,
        kind: insight.kind,
        severity: insight.severity,
        subject,
        title: `${name} — ${Math.round(m.hoursAway ?? 0)} saat sonra, rezervasyon yok`,
        detail: `Kapasite ${m.capacity ?? 0}. Bekleme listesi veya davetle doldurmayı deneyin.`,
        href: '/reservations',
        actionLabel: 'Dersi doldur',
      }
    // PF-41 — credits gone, package still running. The sentence says the two facts that make it
    // urgent together: she cannot book, and the clock is still running.
    case 'credits_exhausted': {
      const days = Math.round(m.daysLeft ?? 0)
      return {
        id: insight.id,
        kind: insight.kind,
        severity: insight.severity,
        subject,
        title: `${name} — ders hakkı bitti, paketi ${days} gün daha geçerli`,
        detail: 'Rezervasyon yapamıyor ama üyeliği sürüyor. Yenileme için en doğru an şimdi.',
        href: memberHref,
        actionLabel: 'Üyeyi aç',
      }
    }
    // PF-41 — money in the account that belongs to nobody. Nothing else will ever raise this:
    // nobody complains about a payment they believe they made.
    case 'unreconciled_payment': {
      const tl = ((m.amountKurus ?? 0) / 100).toLocaleString('tr-TR')
      const days = Math.round(m.daysOpen ?? 0)
      return {
        id: insight.id,
        kind: insight.kind,
        severity: insight.severity,
        subject,
        title: `${tl} ₺ tahsilat eşleşmedi${days > 0 ? ` — ${days} gündür bekliyor` : ''}`,
        detail: 'Ödeme geldi ama hangi üyeye ait olduğu belli değil. Eşleştirilene kadar o üye ödememiş görünüyor.',
        href: '/finance/collections',
        actionLabel: 'Eşleştir',
      }
    }
    case 'dormant_member': {
      const days = Math.round(m.daysSinceActivity ?? 0)
      return {
        id: insight.id,
        kind: insight.kind,
        severity: insight.severity,
        subject,
        title: `${name} — ${days} gündür gelmiyor`,
        detail: 'Aktif paketi var ama uzaklaşıyor. Bir arayıp hatırını sorun — geç olmadan.',
        href: memberHref,
        actionLabel: 'Üyeyi aç',
      }
    }
  }
}

// The pure mapping — takes an ALREADY-loaded dashboard and returns the ranked advisor items. Split out
// so a caller that already holds the snapshot (the dashboard page, the AI checklist) doesn't pay for a
// second read.
export function deriveAdvisorItems(
  dash: OwnerDashboard,
  // Borçlu satırına yazılan iki ek (owner, 2026-09-16): üyenin YAKLAŞAN dersi ve şu an içeride olup olmadığı.
  // Okuma çağıranın işi; bu fonksiyon saf kalır ve testte iki boş koleksiyonla çağrılır.
  upcoming: ReadonlyMap<string, string> = new Map(),
  inside: ReadonlySet<string> = new Set(),
  // Takip notları (owner, 2026-09-18): üye → "ne dedi". Okuma yine çağıranın işi, fonksiyon saf kalır.
  followUps: ReadonlyMap<string, { note: string; byName: string; dueAt: number | null; kind: string }> = new Map(),
): readonly AdvisorItem[] {
  // Names are resolved HERE, never in the domain (the insight is PII-free). The dashboard rows carry
  // them, so no extra read is needed.
  const memberName = new Map<string, string>()
  const sessionName = new Map<string, string>()
  for (const r of dash.expiringSoon) memberName.set(r.id, r.name)
  for (const r of dash.lowCredit) memberName.set(r.id, r.name)
  for (const r of dash.pendingPayments) memberName.set(r.id, r.name)
  for (const r of dash.dormant) memberName.set(r.id, r.name)
  for (const r of dash.exhausted) memberName.set(r.id, r.name)
  for (const s of dash.emptySessions) sessionName.set(s.sessionId, s.serviceName)

  const facts: InsightFacts = {
    expiring: dash.expiringSoon.map((r) => ({ memberId: r.id, entitlementId: r.entitlementId, daysLeft: r.daysLeft, remainingCredits: r.remainingCredits })),
    lowCredit: dash.lowCredit.map((r) => ({ memberId: r.id, entitlementId: r.entitlementId, remaining: r.remaining })),
    balances: dash.pendingPayments.map((r) => ({ memberId: r.id, saleId: r.saleId, dueKurus: r.dueKurus, daysOpen: r.daysOpen })),
    // The dashboard's emptySessions list is already filtered to bookedCount === 0 (owner-dashboard),
    // so booked is 0 by construction.
    emptySessions: dash.emptySessions.map((s) => ({ sessionId: s.sessionId, capacity: s.capacity, booked: 0, hoursAway: s.hoursAway })),
    // Already filtered to daysSinceActivity >= the attention threshold by the dashboard.
    dormant: dash.dormant.map((r) => ({ memberId: r.id, daysSinceActivity: r.daysSinceActivity })),
    // PF-41 — both were already computed for the watch list and never became work anyone was told to
    // do. `exhausted` is the dashboard's remaining === 0 list; the time left is what makes it urgent.
    exhausted: dash.exhausted.map((r) => ({
      memberId: r.id,
      entitlementId: r.entitlementId,
      daysLeft: Math.max(0, Math.ceil((r.validUntil - Date.now()) / 86_400_000)),
    })),
    unreconciled: dash.unreconciledCollections.map((c) => ({
      collectionId: c.id,
      amountKurus: c.amountKurus,
      daysOpen: Math.max(0, Math.floor((Date.now() - c.paidAt) / 86_400_000)),
    })),
  }

  // deriveInsights returns the ranked order (urgent → attention → info); preserve it.
  return deriveInsights(facts, DEFAULT_INSIGHT_CONFIG).map((i) => present(i, memberName, sessionName, upcoming, inside, followUps))
}

export async function loadAdvisor(ctx: TenantContext): Promise<readonly AdvisorItem[]> {
  const nowMs = Date.now()
  const dash = await loadOwnerDashboard(ctx, nowMs)

  // BİR HAFTAYI GEÇMİŞ BORÇ (owner, 2026-09-16): *"pilates rezervasyonu varsa şu gün gelecek, resepsiyon tahsilata
  // baksın; QR ile içeride görülürse uyarı gelsin."* Okuma YALNIZCA bu listeyle sınırlı — bir haftayı geçmemiş
  // borçlular için tek bir sorgu bile atılmaz.
  const HAFTA = 7
  const takipte = dash.pendingPayments.filter((r) => r.daysOpen >= HAFTA)
  const upcoming = new Map<string, string>()
  const inside = new Set<string>()
  if (takipte.length > 0) {
    const branchId = (ctx.branchIds[0] ?? null) as BranchId | null
    const rezRepo = new FirestoreReservationRepository(adminDb())
    const [presence, ...bookings] = await Promise.all([
      branchId ? new FirestoreCheckinRepository(adminDb()).listPresence(ctx, branchId) : Promise.resolve([]),
      ...takipte.map((r) => rezRepo.listByMember(ctx, r.id as MemberId)),
    ])
    for (const p of presence) inside.add(p.memberId as string)
    takipte.forEach((r, i) => {
      const next = [...(bookings[i] ?? [])]
        .filter((x) => x.status === 'booked' && x.sessionStartsAt > nowMs)
        .sort((a, b) => a.sessionStartsAt - b.sessionStartsAt)[0]
      if (next) upcoming.set(r.id, formatDateTime(next.sessionStartsAt))
    })
  }
  // Takip notları: az sayıda belge (yalnızca not bırakılmış üyeler), tek okuma.
  const notlar = await listFollowUps(ctx.studioId as string)
  const followUps = new Map(
    notlar.map((f) => [f.memberId, { note: f.note, byName: f.byName, dueAt: f.dueAt, kind: f.kind }] as const),
  )
  const items = deriveAdvisorItems(dash, upcoming, inside, followUps)
  // SÖZ VERİLEN GÜNE KADAR SUSTUR. Not duruyor, satır yok: liste bugün YAPILACAK işi gösterir ve
  // "22'sinde ödeyecek" bugünün işi değildir. Tarih geçince satır notuyla birlikte geri gelir.
  return items.filter((it) => {
    const due = it.followUp?.dueAt
    return !due || due <= nowMs
  })
}
