'use server'

import {
  debtByMember,
  FirestoreEntitlementRepository,
  FirestoreFinanceRepository,
  FirestoreIdentityRepository,
  FirestoreMemberRepository,
  FirestoreProjectionRepository,
  FirestoreReservationRepository,
  FirestoreSchedulingRepository,
  instant,
  localDateAt,
  systemClock,
} from '@studio/core'
import { z } from 'zod'

import {
  buildCash,
  buildCollections,
  buildDayEnd,
  buildMembership,
  buildReservations,
  buildSales,
  buildTrainer,
  type Report,
} from '@/lib/reports/build'
import type { ReportId } from '@/lib/reports/catalog'

import { requireTenantContext } from '../auth'
import { adminDb } from '../firebase-admin'

// THE REPORTS (v1.27 S6) — one action, one read per report, `ExportableTable` out.
//
// ── Owner only, and the export test says so structurally ────────────────────────────────────
// `/reports` is an owner-only area (owner, 2026-07-13). Every one of these is either the studio's
// business or its members' PII, and a CSV of it is that data in one file, on a laptop, forever.
//
// ── Each report reads ONLY what it needs ────────────────────────────────────────────────────
// There is no "load everything, then filter": a report over a month must not read a year. Every query
// here is bounded by the range the owner chose, and the two that are not (`membership`, `cash`) are
// bounded by the size of the studio itself.

const OWNER = ['owner'] as const

// Europe/Istanbul. Same constant as the dashboard and analytics — Türkiye has no DST, so the offset
// is a number, not a calculation. When a second country arrives this becomes `offsetMinutesAt(tz)`,
// which is why S2 stored the IANA zone rather than a number.
const OFFSET = 180

export interface ReportResult extends Report {
  readonly id: ReportId
}

export async function loadReportAction(input: unknown): Promise<ReportResult> {
  const p = z
    .object({
      id: z.enum(['membership', 'sales', 'collections', 'reservations', 'trainer', 'dayend', 'cash']),
      fromMs: z.number(),
      toMs: z.number(),
    })
    .parse(input)
  const ctx = await requireTenantContext(OWNER)
  const db = adminDb()

  switch (p.id) {
    case 'membership': {
      const [members, entitlements, debt] = await Promise.all([
        new FirestoreMemberRepository(db).list(ctx),
        new FirestoreEntitlementRepository(db).listAll(ctx),
        debtByMember({ repo: new FirestoreFinanceRepository(db), clock: systemClock }, ctx),
      ])
      return {
        id: p.id,
        ...buildMembership(
          members,
          entitlements,
          p.toMs,
          new Map([...debt].map(([id, m]) => [id, m.amount])),
        ),
      }
    }

    case 'sales': {
      const finance = new FirestoreFinanceRepository(db)
      const [sales, members, staff] = await Promise.all([
        finance.listSalesBetween(ctx, p.fromMs, p.toMs),
        new FirestoreMemberRepository(db).list(ctx),
        new FirestoreIdentityRepository(db).listStaff(ctx),
      ])
      return { id: p.id, ...buildSales(sales, members, staff) }
    }

    case 'collections': {
      const finance = new FirestoreFinanceRepository(db)
      const [payments, members, drawers, staff] = await Promise.all([
        finance.listPaymentsBetween(ctx, p.fromMs, p.toMs),
        new FirestoreMemberRepository(db).list(ctx),
        finance.listDrawers(ctx),
        new FirestoreIdentityRepository(db).listStaff(ctx),
      ])
      return { id: p.id, ...buildCollections(payments, members, drawers, staff) }
    }

    case 'reservations': {
      const [reservations, sessions] = await Promise.all([
        new FirestoreReservationRepository(db).listBySessionStartRange(
          ctx,
          instant(p.fromMs),
          instant(p.toMs),
        ),
        new FirestoreSchedulingRepository(db).listSessionsForDay(
          ctx,
          instant(p.fromMs),
          instant(p.toMs),
        ),
      ])
      return { id: p.id, ...buildReservations(reservations, sessions) }
    }

    case 'trainer': {
      const [sessions, reservations] = await Promise.all([
        new FirestoreSchedulingRepository(db).listSessionsForDay(
          ctx,
          instant(p.fromMs),
          instant(p.toMs),
        ),
        new FirestoreReservationRepository(db).listBySessionStartRange(
          ctx,
          instant(p.fromMs),
          instant(p.toMs),
        ),
      ])
      return { id: p.id, ...buildTrainer(sessions, reservations) }
    }

    case 'dayend': {
      // ONE day: the first of whatever range she picked. The screen says so out loud — quietly summing
      // a month into a page headed "Gün sonu" is how a day-end report stops being reconcilable
      // against the till.
      const dayStart = p.fromMs
      const dayEndMs = dayStart + 86_400_000 - 1
      const label = localDateAt(instant(dayStart), OFFSET) as string
      const finance = new FirestoreFinanceRepository(db)
      const [daily, payments, sales, drawers] = await Promise.all([
        new FirestoreProjectionRepository(db).getDaily(ctx, label),
        finance.listPaymentsBetween(ctx, dayStart, dayEndMs),
        finance.listSalesBetween(ctx, dayStart, dayEndMs),
        finance.listDrawers(ctx),
      ])
      return { id: p.id, ...buildDayEnd(label, daily, payments, sales, drawers) }
    }

    case 'cash': {
      const finance = new FirestoreFinanceRepository(db)
      const [all, staff] = await Promise.all([
        finance.listDrawers(ctx),
        new FirestoreIdentityRepository(db).listStaff(ctx),
      ])
      // A drawer is a small, bounded set (one or two per branch), so it is filtered in memory rather
      // than indexed: an index earned by no query is a cost paid for nothing.
      const inRange = all.filter(
        (d) => d.openedAt !== null && d.openedAt >= p.fromMs && d.openedAt <= p.toMs,
      )
      return { id: p.id, ...buildCash(inRange, staff) }
    }
  }
}
