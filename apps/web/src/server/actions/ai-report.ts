'use server'

import { z } from 'zod'

import { requireTenantContext } from '../auth'
import { adminDb } from '../firebase-admin'
import type { Temp } from './conversations'

// The WhatsApp AI receptionist's analytics — "ne kadar gerçekçi, ne kadar verimli". A funnel over the
// conversation pool: kaç kişi yazdı → devam etti → sıcak oldu → ÜYE oldu (matched by phone to /members),
// plus a per-person breakdown (kaç kez, tarihler, skor) and a daily "kaç kişi yazdı" series. Owner-only:
// it reveals the whole lead pipeline. Bounded reads (conversations + member phones).
const OWNER = ['owner', 'platform_admin'] as const
const DAY = 86_400_000
const digits = (s: string) => s.replace(/\D/g, '').replace(/^0+/, '')
const dayKey = (ms: number) => new Date(ms).toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' })

export interface AiReportPerson {
  readonly phone: string
  readonly name: string
  readonly firstAt: number
  readonly lastAt: number
  readonly userMsgs: number // "kaç kez yazmış" — gönderdiği mesaj sayısı
  readonly days: number // kaç ayrı gün yazmış
  readonly temp: Temp | null
  readonly status: 'ai' | 'human'
  readonly converted: boolean // telefonu bir üyeyle eşleşiyor mu (kayıt oldu)
}
export interface AiReport {
  readonly funnel: { readonly wrote: number; readonly engaged: number; readonly hot: number; readonly converted: number }
  readonly daily: readonly { readonly day: string; readonly count: number }[]
  readonly people: readonly AiReportPerson[]
  readonly periodDays: number
}

export async function aiReportAction(input: unknown): Promise<AiReport> {
  const p = z.object({ days: z.number().int().min(0).max(365).default(30) }).parse(input)
  const ctx = await requireTenantContext(OWNER)
  const now = Date.now()
  const since = p.days > 0 ? now - p.days * DAY : 0

  const [convSnap, memberSnap] = await Promise.all([
    adminDb().collection(`studios/${ctx.studioId}/conversations`).orderBy('lastAt', 'desc').limit(1000).get(),
    adminDb().collection(`studios/${ctx.studioId}/members`).get(),
  ])

  const memberPhones = new Set<string>()
  for (const m of memberSnap.docs) {
    const d = m.data() as Record<string, unknown>
    const ph = String(d.phoneNormalized ?? d.phone ?? '')
    if (ph) memberPhones.add(digits(ph))
  }

  const people: AiReportPerson[] = []
  const dailyMap = new Map<string, number>()
  for (const doc of convSnap.docs) {
    const c = doc.data() as Record<string, unknown>
    const msgs = (c.messages as { role: string; text: string; at: number }[] | undefined) ?? []
    const userMsgs = msgs.filter((m) => m.role === 'user')
    if (userMsgs.length === 0) continue
    const firstAt = userMsgs[0]?.at ?? Number(c.lastAt ?? 0)
    if (firstAt < since) continue // first contact outside the period
    const phone = String(c.phone ?? doc.id)
    const temp = c.temp === 'sıcak' || c.temp === 'ılık' || c.temp === 'soğuk' ? (c.temp as Temp) : null
    people.push({
      phone,
      name: String(c.name || phone.slice(-6)),
      firstAt,
      lastAt: Number(c.lastAt ?? firstAt),
      userMsgs: userMsgs.length,
      days: new Set(userMsgs.map((m) => dayKey(m.at))).size,
      temp,
      status: (c.status as 'ai' | 'human') ?? 'ai',
      converted: memberPhones.has(digits(phone)),
    })
    dailyMap.set(dayKey(firstAt), (dailyMap.get(dayKey(firstAt)) ?? 0) + 1)
  }

  const funnel = {
    wrote: people.length,
    engaged: people.filter((x) => x.userMsgs >= 2).length, // konuşmaya devam etti
    hot: people.filter((x) => x.temp === 'sıcak').length, // gerçek müşteri potansiyeli
    converted: people.filter((x) => x.converted).length, // kayıt oldu
  }
  const daily = [...dailyMap.entries()].map(([day, count]) => ({ day, count })).sort((a, b) => a.day.localeCompare(b.day))
  people.sort((a, b) => b.lastAt - a.lastAt)
  return { funnel, daily, people, periodDays: p.days }
}
