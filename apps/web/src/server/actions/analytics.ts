'use server'

import {
  FirestoreProjectionRepository,
  FirestoreSchedulingRepository,
  instant,
  localDateAt,
  type DailyReadModel,
} from '@studio/core'
import { z } from 'zod'

import { requireTenantContext } from '../auth'
import { adminDb } from '../firebase-admin'

// D25 — analytics. Every number comes from the daily read model or from the sessions themselves;
// not one is maintained by hand. Loaded LAZILY, on its own route: charts must never slow the
// dashboard's first paint (owner).
const STAFF = ['owner', 'receptionist', 'trainer'] as const

const OFFSET = 180

export interface AnalyticsSeries {
  readonly days: readonly DailyReadModel[]
  // Occupancy is computed from the SESSIONS, not from a counter: a session's `bookedCount` is
  // maintained transactionally by the booking path, so it is authoritative, and it is the only
  // place that knows a class was cancelled after it was booked.
  readonly occupancyByDay: readonly { date: string; booked: number; capacity: number }[]
  readonly byHour: Readonly<Record<string, { booked: number; capacity: number }>>
  readonly byTrainer: readonly { trainerId: string; name: string; sessions: number; booked: number }[]
  readonly salesByProduct: readonly { productId: string; name: string; amountKurus: number }[]
}

// One range vocabulary for the whole product (owner): the feed, the analytics screen and every
// future report speak it. `fromMs`/`toMs` are absolute instants — the caller resolves the label,
// the server never guesses what "dün" meant in the browser's timezone.
export async function loadAnalyticsAction(input: unknown): Promise<AnalyticsSeries> {
  const p = z
    .object({
      fromMs: z.number(),
      toMs: z.number(),
    })
    .parse(input)
  const ctx = await requireTenantContext(STAFF)
  const db = adminDb()

  const fromMs = p.fromMs
  const nowMs = p.toMs
  const from = localDateAt(instant(fromMs), OFFSET) as string
  const to = localDateAt(instant(nowMs), OFFSET) as string

  const sched = new FirestoreSchedulingRepository(db)
  // Three reads for the whole analytics page: the day docs, the sessions in range, the catalogue.
  // Trainer names ride along on the sessions themselves (they are denormalised there), so there is
  // no fourth query and certainly no query per trainer.
  const [days, sessions, products] = await Promise.all([
    new FirestoreProjectionRepository(db).listDaily(ctx, from, to),
    sched.listSessionsForDay(ctx, instant(fromMs), instant(nowMs)),
    db.collection(`studios/${ctx.studioId}/products`).get(),
  ])

  const live = sessions.filter((s) => s.status !== 'cancelled' && s.capacity > 0)

  const occ = new Map<string, { booked: number; capacity: number }>()
  const hours = new Map<string, { booked: number; capacity: number }>()
  const trainers = new Map<string, { sessions: number; booked: number }>()
  for (const s of live) {
    const date = localDateAt(s.startsAt, OFFSET) as string
    const d = occ.get(date) ?? { booked: 0, capacity: 0 }
    occ.set(date, { booked: d.booked + s.bookedCount, capacity: d.capacity + s.capacity })

    const hour = new Date(s.startsAt + OFFSET * 60_000).toISOString().slice(11, 13)
    const h = hours.get(hour) ?? { booked: 0, capacity: 0 }
    hours.set(hour, { booked: h.booked + s.bookedCount, capacity: h.capacity + s.capacity })

    if (s.trainerId) {
      const t = trainers.get(s.trainerId as string) ?? { sessions: 0, booked: 0 }
      trainers.set(s.trainerId as string, { sessions: t.sessions + 1, booked: t.booked + s.bookedCount })
    }
  }

  const trainerNames = new Map(
    live.filter((s) => s.trainerId).map((s) => [s.trainerId as string, s.trainerName ?? 'Eğitmen']),
  )
  const productNames = new Map(products.docs.map((d) => [d.id, (d.get('name') as string) ?? 'Paket']))

  const salesTotals = new Map<string, number>()
  for (const day of days) {
    for (const [productId, amount] of Object.entries(day.salesByProduct)) {
      salesTotals.set(productId, (salesTotals.get(productId) ?? 0) + amount)
    }
  }

  return {
    days,
    occupancyByDay: [...occ.entries()]
      .map(([date, v]) => ({ date, ...v }))
      .sort((a, b) => (a.date < b.date ? -1 : 1)),
    byHour: Object.fromEntries([...hours.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))),
    byTrainer: [...trainers.entries()]
      .map(([trainerId, v]) => ({ trainerId, name: trainerNames.get(trainerId) ?? 'Eğitmen', ...v }))
      .sort((a, b) => b.sessions - a.sessions),
    salesByProduct: [...salesTotals.entries()]
      .map(([productId, amountKurus]) => ({
        productId,
        name: productNames.get(productId) ?? 'Paket',
        amountKurus,
      }))
      .sort((a, b) => b.amountKurus - a.amountKurus),
  }
}
