import 'server-only'

import { FirestoreProjectionRepository, type TenantContext } from '@studio/core'

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
  const [dash, monthDaily, prevDaily, leads] = await Promise.all([
    loadOwnerDashboard(ctx, now),
    projRepo.listDaily(ctx, monthStart, today),
    projRepo.listDaily(ctx, prevMonthStart, prevMonthEnd),
    loadLeadSignal(ctx.studioId, now),
  ])

  const emptyNext48h = dash.emptySessions.filter((s) => s.hoursAway <= 48).length
  const emptyNext7d = dash.emptySessions.length

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
      if (c.temp === 'sıcak') hot++
    }
    return { wrote, engaged, hot }
  } catch {
    return { wrote: 0, engaged: 0, hot: 0 }
  }
}
