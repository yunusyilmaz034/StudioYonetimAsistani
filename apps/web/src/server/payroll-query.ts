import {
  computeStatement,
  FirestoreFinanceRepository,
  FirestoreIdentityRepository,
  FirestorePayrollRepository,
  FirestoreReservationRepository,
  FirestoreSchedulingRepository,
  instant,
  offsetMinutesAt,
  statementIdFor,
  type AttributedSaleInput,
  type CompensationPlan,
  type Instant,
  type PayrollStatement,
  type PayrollStatementDraft,
  type RealisedClassInput,
  type TenantContext,
} from '@studio/core'

import { adminDb } from './firebase-admin'

// ── THE PAYROLL LOADING BRIDGE (Plus Phase 9). ──────────────────────────────────────────────────
//
// The correctness-critical join: it reads the studio's existing facts — the sessions a trainer taught,
// the attendance on those sessions, the sales attributed to her — and feeds the PURE `computeStatement`.
// It writes nothing and derives nothing about money itself; the domain does all the arithmetic. A
// statement is a REPORT here until the owner finalizes it.

export interface PayrollTrainer {
  readonly id: string
  readonly displayName: string
  readonly role: string
}

// Any ACTIVE staff member may teach (a small studio's owner teaches) — so the payroll picker is every
// active principal, not only role==='trainer'.
export async function listPayrollTrainers(ctx: TenantContext): Promise<readonly PayrollTrainer[]> {
  const staff = await new FirestoreIdentityRepository(adminDb()).listStaff(ctx)
  return staff.filter((s) => s.active).map((s) => ({ id: s.id as string, displayName: s.displayName, role: s.role }))
}

async function studioOffset(ctx: TenantContext): Promise<number> {
  const settings = await new FirestoreSchedulingRepository(adminDb()).getStudioSettings(ctx)
  return offsetMinutesAt(settings?.timeZone ?? 'Europe/Istanbul', instant(Date.now()))
}

function localParts(ms: number, offsetMin: number): { y: number; m: number; d: number } {
  const local = new Date(ms + offsetMin * 60_000)
  return { y: local.getUTCFullYear(), m: local.getUTCMonth() + 1, d: local.getUTCDate() }
}
const pad = (n: number, w = 2) => String(n).padStart(w, '0')

// A deterministic key for the period, in STUDIO-LOCAL time. A whole calendar month → `YYYY-MM`; any
// other range → `YYYYMMDD-YYYYMMDD` (inclusive last day). The action and the query must agree on this,
// so both call it.
export function periodKeyFor(periodStart: Instant, periodEnd: Instant, offsetMin: number): string {
  const a = localParts(periodStart, offsetMin)
  const lastDay = localParts(periodEnd - 1, offsetMin) // periodEnd is exclusive
  const isWholeMonth = a.d === 1 && lastDay.y === a.y && lastDay.m === a.m && localParts(periodEnd, offsetMin).d === 1
  if (isWholeMonth) return `${a.y}-${pad(a.m)}`
  return `${a.y}${pad(a.m)}${pad(a.d)}-${lastDay.y}${pad(lastDay.m)}${pad(lastDay.d)}`
}

export interface StatementLoad {
  readonly plan: CompensationPlan | null
  readonly periodKey: string
  readonly draft: PayrollStatementDraft | null
  readonly existing: PayrollStatement | null
}

export async function loadStatementDraft(
  ctx: TenantContext,
  trainerId: string,
  periodStart: Instant,
  periodEnd: Instant,
  asOf: Instant,
): Promise<StatementLoad> {
  const db = adminDb()
  const offsetMin = await studioOffset(ctx)
  const periodKey = periodKeyFor(periodStart, periodEnd, offsetMin)
  const payrollRepo = new FirestorePayrollRepository(db)

  const plan = await payrollRepo.getPlan(ctx, trainerId)
  const existing = await payrollRepo.getStatement(ctx, statementIdFor(trainerId, periodKey))
  if (!plan) return { plan: null, periodKey, draft: null, existing }

  const [sessions, reservations, sales, adjustments] = await Promise.all([
    new FirestoreSchedulingRepository(db).listSessionsForDay(ctx, periodStart, periodEnd),
    new FirestoreReservationRepository(db).listBySessionStartRange(ctx, periodStart, periodEnd),
    new FirestoreFinanceRepository(db).listSalesBetween(ctx, periodStart, periodEnd),
    payrollRepo.listAdjustments(ctx, trainerId, periodKey),
  ])

  // Attendance is joined to a session by classSessionId only (reservations carry no trainerId).
  // Classify by status + attendanceSource: observed = trainer-marked; presumed = system_default; no-show.
  const counts = new Map<string, { attendedObserved: number; attendedPresumed: number; noShow: number }>()
  for (const r of reservations) {
    const key = r.classSessionId as string
    const c = counts.get(key) ?? { attendedObserved: 0, attendedPresumed: 0, noShow: 0 }
    if (r.status === 'attended' && r.attendanceSource === 'trainer') c.attendedObserved++
    else if (r.status === 'attended' && r.attendanceSource === 'system_default') c.attendedPresumed++
    else if (r.status === 'no_show') c.noShow++
    counts.set(key, c)
  }

  const classes: RealisedClassInput[] = sessions
    .filter((s) => (s.trainerId as string | null) === trainerId)
    .map((s) => {
      const c = counts.get(s.id as string) ?? { attendedObserved: 0, attendedPresumed: 0, noShow: 0 }
      return {
        sessionId: s.id as string,
        startsAt: s.startsAt,
        endsAt: s.endsAt,
        cancelled: s.status === 'cancelled',
        attendedObserved: c.attendedObserved,
        attendedPresumed: c.attendedPresumed,
        noShow: c.noShow,
      }
    })

  const attributedSales: AttributedSaleInput[] = sales
    .filter((sale) => (sale.soldBy as { id: string }).id === trainerId && sale.status !== 'cancelled')
    .map((sale) => ({ saleId: sale.id, total: sale.total }))

  const draft = computeStatement({
    plan,
    periodStart,
    periodEnd,
    asOf,
    classes,
    sales: attributedSales,
    adjustments: adjustments.map((a) => ({ adjustmentId: a.id, kind: a.kind, amount: a.amount, note: a.note })),
  })

  return { plan, periodKey, draft, existing }
}
