import {
  getFirestore,
  Timestamp,
  type CollectionReference,
  type DocumentData,
  type Firestore,
  type Transaction,
} from 'firebase-admin/firestore'

import { instant, newEventId, type NewEvent, type StudioId, type TenantContext } from '../../../shared'
import type { ListStatementsQuery, PayrollRepository } from '../application/ports'
import type { Adjustment, CompensationPlan, PayrollStatement, PayrollStatementDraft } from '../domain/types'

// The payroll module's ONLY firebase-admin importer. State document(s) + their events commit together
// (#1). Money is stored as its `{ amount, currency }` object, never a bare number (#10); the draft
// snapshot is plain JSON with Money objects inside, round-tripped as-is (no Instant fields inside it
// except periodStart/periodEnd, which are numeric millis — Instant is a branded number, JSON-safe).

const ts = (ms: number): Timestamp => Timestamp.fromMillis(ms)
const ms = (v: unknown): number => (v instanceof Timestamp ? v.toMillis() : typeof v === 'number' ? v : 0)

const planTo = (p: CompensationPlan): DocumentData => ({ ...p, updatedAt: ts(p.updatedAt) })
const planFrom = (id: string, d: DocumentData): CompensationPlan => ({ ...(d as CompensationPlan), id, updatedAt: instant(ms(d.updatedAt)) })

const adjustmentTo = (a: Adjustment): DocumentData => ({ ...a, recordedAt: ts(a.recordedAt) })
const adjustmentFrom = (id: string, d: DocumentData): Adjustment => ({ ...(d as Adjustment), id, recordedAt: instant(ms(d.recordedAt)) })

// The draft carries Instant (periodStart/periodEnd) as plain numbers and Money objects — both JSON
// values, so the snapshot persists verbatim. Only the statement's own timestamps need conversion.
const statementTo = (s: PayrollStatement): DocumentData => ({
  ...s,
  periodStart: ts(s.periodStart),
  periodEnd: ts(s.periodEnd),
  finalizedAt: ts(s.finalizedAt),
  paidAt: s.paidAt !== null ? ts(s.paidAt) : null,
})
const statementFrom = (id: string, d: DocumentData): PayrollStatement => ({
  ...(d as PayrollStatement),
  id,
  periodStart: instant(ms(d.periodStart)),
  periodEnd: instant(ms(d.periodEnd)),
  finalizedAt: instant(ms(d.finalizedAt)),
  paidAt: d.paidAt ? instant(ms(d.paidAt)) : null,
  // The frozen draft is stored as-is; its numeric periodStart/periodEnd were never Timestamps.
  draft: d.draft as PayrollStatementDraft,
})

export class FirestorePayrollRepository implements PayrollRepository {
  constructor(private readonly db: Firestore = getFirestore()) {}

  private col(sid: StudioId, name: string): CollectionReference {
    return this.db.collection('studios').doc(sid).collection(name)
  }
  private writeEvents(sid: StudioId, tx: Transaction, events: readonly NewEvent[]): void {
    for (const e of events) {
      tx.set(this.col(sid, 'events').doc(newEventId()), { ...e, occurredAt: ts(e.occurredAt), recordedAt: Timestamp.now() })
    }
  }

  // ── Compensation plans (one per trainer, doc id = trainerId) ──
  async getPlan(ctx: TenantContext, trainerId: string): Promise<CompensationPlan | null> {
    const s = await this.col(ctx.studioId, 'compensationPlans').doc(trainerId).get()
    const d = s.data()
    return d ? planFrom(trainerId, d) : null
  }
  async listPlans(ctx: TenantContext): Promise<readonly CompensationPlan[]> {
    const snap = await this.col(ctx.studioId, 'compensationPlans').get()
    return snap.docs.map((d) => planFrom(d.id, d.data()))
  }
  async savePlan(ctx: TenantContext, plan: CompensationPlan, events: readonly NewEvent[]): Promise<void> {
    const sid = ctx.studioId
    await this.db.runTransaction(async (tx) => {
      tx.set(this.col(sid, 'compensationPlans').doc(plan.id), planTo(plan))
      this.writeEvents(sid, tx, events)
    })
  }

  // ── Statements (persisted only once finalized; doc id = `${trainerId}__${periodKey}`) ──
  async getStatement(ctx: TenantContext, statementId: string): Promise<PayrollStatement | null> {
    const s = await this.col(ctx.studioId, 'payrollStatements').doc(statementId).get()
    const d = s.data()
    return d ? statementFrom(statementId, d) : null
  }
  async listStatements(ctx: TenantContext, query: ListStatementsQuery): Promise<readonly PayrollStatement[]> {
    let q = this.col(ctx.studioId, 'payrollStatements') as FirebaseFirestore.Query
    if (query.trainerId) q = q.where('trainerId', '==', query.trainerId)
    if (query.from !== undefined) q = q.where('periodStart', '>=', Timestamp.fromMillis(query.from))
    if (query.to !== undefined) q = q.where('periodStart', '<', Timestamp.fromMillis(query.to))
    const snap = await q.get()
    return snap.docs.map((d) => statementFrom(d.id, d.data())).sort((a, b) => b.periodStart - a.periodStart)
  }
  async saveStatement(ctx: TenantContext, statement: PayrollStatement, events: readonly NewEvent[]): Promise<void> {
    const sid = ctx.studioId
    await this.db.runTransaction(async (tx) => {
      tx.set(this.col(sid, 'payrollStatements').doc(statement.id), statementTo(statement))
      this.writeEvents(sid, tx, events)
    })
  }

  // ── Adjustments (a history keyed by trainer + period) ──
  async saveAdjustment(ctx: TenantContext, adjustment: Adjustment, events: readonly NewEvent[]): Promise<void> {
    const sid = ctx.studioId
    await this.db.runTransaction(async (tx) => {
      tx.set(this.col(sid, 'payrollAdjustments').doc(adjustment.id), adjustmentTo(adjustment))
      this.writeEvents(sid, tx, events)
    })
  }
  async listAdjustments(ctx: TenantContext, trainerId: string, periodKey: string): Promise<readonly Adjustment[]> {
    const snap = await this.col(ctx.studioId, 'payrollAdjustments')
      .where('trainerId', '==', trainerId)
      .where('periodKey', '==', periodKey)
      .get()
    return snap.docs.map((d) => adjustmentFrom(d.id, d.data())).sort((a, b) => a.recordedAt - b.recordedAt)
  }
}
