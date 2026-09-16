import 'server-only'

import { FirestoreProjectionRepository, type TenantContext } from '@studio/core'

import { loadAnalyticsAction } from './actions/analytics'
import { adminDb } from './firebase-admin'
import { loadOwnerDashboard } from './owner-dashboard'

// The PATRON SNAPSHOT — a bounded, deterministic picture of the business that grounds the AI Patron
// Asistanı. Every number here is computed by us (never by the model); the assistant may only NARRATE
// and INTERPRET these figures. This is the discipline that stops a hallucinated revenue number from
// reaching a decision (the same posture as the checklist narrator).
//
// It reuses the owner dashboard (one bounded read set), adds a this-month / last-month revenue trend
// (a range read over the daily projections) and a light WhatsApp lead signal. Member NAMES are carried
// in small lists so the AI layer can tokenise them out; the full id lists (`audiences`) never reach the
// model — they exist only to target an owner-confirmed action.

const DAY = 86_400_000
const TZ = 'Europe/Istanbul'
const localDate = (ms: number) => new Date(ms).toLocaleDateString('en-CA', { timeZone: TZ })
const sum = (rows: readonly { salesKurus: number; collectedKurus: number }[], k: 'salesKurus' | 'collectedKurus') =>
  rows.reduce((n, r) => n + (r[k] || 0), 0)

export interface PatronNamedRef {
  readonly id: string
  readonly name: string
  readonly detail: string // "4.200 ₺ · 12 gün" — a short human tag the AI may reference
}

export interface PatronSnapshot {
  readonly date: string
  readonly money: {
    readonly todaySalesKurus: number
    readonly todayCollectedKurus: number
    readonly monthSalesKurus: number
    readonly monthCollectedKurus: number
    readonly prevMonthSalesKurus: number
    readonly prevMonthCollectedKurus: number
    readonly pendingTotalKurus: number
    readonly pendingCount: number
  }
  readonly members: {
    readonly active: number
    readonly new30d: number
    readonly expiringCount: number
    readonly lowCreditCount: number
    readonly dormantCount: number
    readonly expiring: readonly PatronNamedRef[] // capped sample for the AI to name
    readonly lowCredit: readonly PatronNamedRef[]
    readonly dormant: readonly PatronNamedRef[]
    readonly debtors: readonly PatronNamedRef[]
  }
  readonly operations: {
    readonly occupancyBooked: number
    readonly occupancyCapacity: number
    readonly emptyNext48h: number
    readonly emptyNext7d: number
    // ── YOĞUNLUK VE SATIŞ DAĞILIMI (owner, 2026-09-16) ────────────────────────────────────────
    // *"Hangi günler daha yoğun, yoğun saatler ne, hangi günlerde daha çok satış yapılıyor?"* Son 30 günün
    // GERÇEK kayıtlarından: giriş sayısı check-in'den, saat yoğunluğu dolu rezervasyondan, satış günlük
    // özetten. Asistan sayı uydurmaz — yalnızca burada verdiğimiz rakamları yorumlar.
    readonly busyDays: readonly { readonly day: string; readonly checkIns: number; readonly salesKurus: number }[]
    readonly busyHours: readonly { readonly hour: string; readonly booked: number }[]
  }
  readonly leads: {
    readonly wrote: number
    readonly engaged: number
    readonly hot: number
  }
  // Deterministic action audiences — member ids only, NEVER sent to the model. Used to target an
  // owner-confirmed send (borç hatırlatma / yenileme / kaçan üye dönüşü).
  readonly audiences: {
    readonly debtors: readonly string[]
    readonly expiring: readonly string[]
    readonly dormant: readonly string[]
  }
}

const CAP = 10 // how many named members to hand the AI per list (bounds tokens; the count is separate)
const kurus = (k: number) => `${(k / 100).toLocaleString('tr-TR')} ₺`

export async function loadPatronSnapshot(ctx: TenantContext): Promise<PatronSnapshot> {
  const now = Date.now()
  const today = localDate(now)
  const monthStart = `${today.slice(0, 7)}-01`
  const prevMonthEndMs = new Date(`${monthStart}T00:00:00Z`).getTime() - DAY
  const prevMonth = localDate(prevMonthEndMs).slice(0, 7)
  const prevMonthStart = `${prevMonth}-01`
  const prevMonthEnd = localDate(prevMonthEndMs)

  const projRepo = new FirestoreProjectionRepository(adminDb())
  const [dash, monthDaily, prevDaily, leads, analytics] = await Promise.all([
    loadOwnerDashboard(ctx, now),
    projRepo.listDaily(ctx, monthStart, today),
    projRepo.listDaily(ctx, prevMonthStart, prevMonthEnd),
    loadLeadSignal(ctx.studioId, now),
    loadAnalyticsAction({ fromMs: now - 30 * DAY, toMs: now }),
  ])

  const emptyNext48h = dash.emptySessions.filter((s) => s.hoursAway <= 48).length
  const emptyNext7d = dash.emptySessions.length

  // Son 30 günün günlük özetleri: haftanın gününe göre toplanır. Tek okuma, sınırlı aralık.
  const last30 = await projRepo.listDaily(ctx, localDate(now - 30 * DAY), today)
  const GUN_ADI = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi']
  const gunler = new Map<string, { checkIns: number; salesKurus: number }>()
  for (const d of last30) {
    // `date` stüdyo günü ('YYYY-MM-DD'); UTC olarak okumak haftanın gününü kaydırmaz.
    const ad = GUN_ADI[new Date(`${d.date}T00:00:00Z`).getUTCDay()] ?? d.date
    const acc = gunler.get(ad) ?? { checkIns: 0, salesKurus: 0 }
    gunler.set(ad, { checkIns: acc.checkIns + d.checkIns, salesKurus: acc.salesKurus + d.salesKurus })
  }
  const busyDays = [...gunler.entries()]
    .map(([day, v]) => ({ day, ...v }))
    .sort((a, b) => b.checkIns - a.checkIns)
  const busyHours = Object.entries(analytics.byHour)
    .map(([hour, v]) => ({ hour: `${hour}:00`, booked: v.booked }))
    .filter((h) => h.booked > 0)
    .sort((a, b) => b.booked - a.booked)
    .slice(0, 6)

  const ref = (id: string, name: string, detail: string): PatronNamedRef => ({ id, name, detail })

  return {
    date: today,
    money: {
      todaySalesKurus: dash.today.salesKurus,
      todayCollectedKurus: dash.today.collectedKurus,
      monthSalesKurus: sum(monthDaily, 'salesKurus'),
      monthCollectedKurus: sum(monthDaily, 'collectedKurus'),
      prevMonthSalesKurus: sum(prevDaily, 'salesKurus'),
      prevMonthCollectedKurus: sum(prevDaily, 'collectedKurus'),
      pendingTotalKurus: dash.pendingPayments.reduce((n, p) => n + p.dueKurus, 0),
      pendingCount: dash.pendingPayments.length,
    },
    members: {
      active: dash.activeMembers,
      new30d: dash.newMembers30d,
      expiringCount: dash.expiringSoon.length,
      lowCreditCount: dash.lowCredit.length,
      dormantCount: dash.dormant.length,
      expiring: dash.expiringSoon.slice(0, CAP).map((r) => ref(r.id, r.name, `${r.daysLeft <= 0 ? 'bugün doluyor' : `${r.daysLeft} gün`}`)),
      lowCredit: dash.lowCredit.slice(0, CAP).map((r) => ref(r.id, r.name, `${r.remaining} ders kaldı`)),
      dormant: dash.dormant.slice(0, CAP).map((r) => ref(r.id, r.name, `${Math.round(r.daysSinceActivity)} gündür yok`)),
      debtors: dash.pendingPayments.slice(0, CAP).map((r) => ref(r.id, r.name, `${kurus(r.dueKurus)} · ${r.daysOpen} gün`)),
    },
    operations: {
      occupancyBooked: dash.occupancy.booked,
      occupancyCapacity: dash.occupancy.capacity,
      emptyNext48h,
      emptyNext7d,
      busyDays,
      busyHours,
    },
    leads,
    audiences: {
      debtors: dash.pendingPayments.map((p) => p.id),
      expiring: dash.expiringSoon.map((r) => r.id),
      dormant: dash.dormant.map((r) => r.id),
    },
  }
}

// A LIGHT WhatsApp lead signal for the last 30 days — kaç kişi yazdı, kaçı konuşmaya devam etti, kaçı
// sıcak. The detailed funnel (with conversion) lives in AI Rapor; here we stay to one bounded read.
async function loadLeadSignal(studioId: string, now: number): Promise<{ wrote: number; engaged: number; hot: number }> {
  const since = now - 30 * DAY
  try {
    const snap = await adminDb().collection(`studios/${studioId}/conversations`).orderBy('lastAt', 'desc').limit(1000).get()
    let wrote = 0
    let engaged = 0
    let hot = 0
    for (const doc of snap.docs) {
      const c = doc.data() as Record<string, unknown>
      const msgs = (c.messages as { role?: string; at?: number }[] | undefined) ?? []
      const userMsgs = msgs.filter((m) => m.role === 'user')
      const firstAt = userMsgs[0]?.at ?? Number(c.lastAt ?? 0)
      if (userMsgs.length === 0 || firstAt < since) continue
      wrote++
      if (userMsgs.length >= 2) engaged++
      // Aşama tabanlı (2026-09-01). "Sıcak" nüfusun yarısıydı ve bir sayı olarak hiçbir şey
      // söylemiyordu; "randevulu + fiyat verildi" ise gerçekten satışa yakın olanları sayar.
      const st = String((c as { stage?: string; temp?: string }).stage ?? '')
      if (st === 'randevu' || st === 'fiyat' || c.temp === 'sıcak') hot++
    }
    return { wrote, engaged, hot }
  } catch {
    return { wrote: 0, engaged: 0, hot: 0 }
  }
}
