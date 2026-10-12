import { getFirestore, Timestamp, type CollectionReference, type DocumentData, type Firestore, type Transaction } from 'firebase-admin/firestore'

import { instant, newEventId, type NewEvent, type StudioId, type TenantContext } from '../../../shared'
import type { EnergyRepository } from '../application/ports'
import { energyDayId } from '../domain/decide'
import type { CardioEntry, EnergyDay, EnergyProfile } from '../domain/types'

// The energy module's ONLY firebase-admin importer. A day's document and its event commit together
// (#1). Weight, height, body fat and every figure derived from them live HERE, on member-scoped
// documents, and never in an event (#6) — which is what lets `eraseMember` actually erase them.
//
//   studios/{sid}/energyProfiles/{memberId}
//   studios/{sid}/energyDays/{memberId}_{YYYY-MM-DD}

const ts = (ms: number): Timestamp => Timestamp.fromMillis(ms)
const ms = (v: unknown): number => (v instanceof Timestamp ? v.toMillis() : typeof v === 'number' ? v : 0)

const profileTo = (p: EnergyProfile): DocumentData => ({ ...p, consentedAt: ts(p.consentedAt), startedAt: ts(p.startedAt), updatedAt: ts(p.updatedAt) })
const profileFrom = (d: DocumentData): EnergyProfile => ({
  ...(d as EnergyProfile),
  bodyFatPercent: typeof d.bodyFatPercent === 'number' ? d.bodyFatPercent : null,
  consentedAt: instant(ms(d.consentedAt)),
  startedAt: instant(ms(d.startedAt)),
  updatedAt: instant(ms(d.updatedAt)),
})

const dayTo = (d: EnergyDay): DocumentData => ({
  ...d,
  steps: d.steps ? { ...d.steps, loggedAt: ts(d.steps.loggedAt) } : null,
  cardio: d.cardio.map((c) => ({ ...c, loggedAt: ts(c.loggedAt) })),
  updatedAt: ts(d.updatedAt),
})
const dayFrom = (id: string, d: DocumentData): EnergyDay => ({
  ...(d as EnergyDay),
  id,
  steps: d.steps ? { count: Number(d.steps.count), kcal: Number(d.steps.kcal), loggedAt: instant(ms(d.steps.loggedAt)) } : null,
  cardio: Array.isArray(d.cardio) ? d.cardio.map((c: DocumentData) => ({ ...(c as CardioEntry), loggedAt: instant(ms(c.loggedAt)) })) : [],
  workoutMinutes: (d.workoutMinutes ?? {}) as Record<string, number>,
  updatedAt: instant(ms(d.updatedAt)),
})

export class FirestoreEnergyRepository implements EnergyRepository {
  constructor(private readonly db: Firestore = getFirestore()) {}

  private col(sid: StudioId, name: string): CollectionReference {
    return this.db.collection('studios').doc(sid).collection(name)
  }
  private writeEvents(sid: StudioId, tx: Transaction | FirebaseFirestore.WriteBatch, events: readonly NewEvent[]): void {
    for (const e of events) {
      const ref = this.col(sid, 'events').doc(newEventId())
      const data = { ...e, occurredAt: ts(e.occurredAt), recordedAt: Timestamp.now() }
      // Both writers take (ref, data); the union does not let TypeScript see that they agree.
      ;(tx as Transaction).set(ref, data)
    }
  }

  async getProfile(ctx: TenantContext, memberId: string): Promise<EnergyProfile | null> {
    const s = await this.col(ctx.studioId, 'energyProfiles').doc(memberId).get()
    const d = s.data()
    return d ? profileFrom(d) : null
  }
  async listProfiles(ctx: TenantContext): Promise<readonly EnergyProfile[]> {
    const snap = await this.col(ctx.studioId, 'energyProfiles').get()
    return snap.docs.map((d) => profileFrom(d.data()))
  }
  async saveProfile(ctx: TenantContext, profile: EnergyProfile, events: readonly NewEvent[]): Promise<void> {
    const sid = ctx.studioId
    await this.db.runTransaction(async (tx) => {
      tx.set(this.col(sid, 'energyProfiles').doc(profile.memberId), profileTo(profile))
      this.writeEvents(sid, tx, events)
    })
  }

  async countDays(ctx: TenantContext, memberId: string): Promise<number> {
    const snap = await this.col(ctx.studioId, 'energyDays').where('memberId', '==', memberId).count().get()
    return snap.data().count
  }
  async eraseMember(ctx: TenantContext, memberId: string, events: readonly NewEvent[]): Promise<void> {
    const sid = ctx.studioId
    const days = await this.col(sid, 'energyDays').where('memberId', '==', memberId).get()
    // Days first, in chunks (a batch holds 500 writes and a year of days is 365). The PROFILE and the
    // event go LAST and together: if a chunk fails, she is still "tracking" and pressing the button
    // again finishes the job — never a member with no profile and orphaned days nobody can reach.
    const refs = days.docs.map((d) => d.ref)
    for (let i = 0; i < refs.length; i += 400) {
      const batch = this.db.batch()
      refs.slice(i, i + 400).forEach((r) => batch.delete(r))
      await batch.commit()
    }
    const last = this.db.batch()
    last.delete(this.col(sid, 'energyProfiles').doc(memberId))
    this.writeEvents(sid, last, events)
    await last.commit()
  }

  async getDay(ctx: TenantContext, memberId: string, date: string): Promise<EnergyDay | null> {
    const id = energyDayId(memberId, date)
    const s = await this.col(ctx.studioId, 'energyDays').doc(id).get()
    const d = s.data()
    return d ? dayFrom(id, d) : null
  }
  async listDays(ctx: TenantContext, memberId: string, from: string, to: string): Promise<readonly EnergyDay[]> {
    // By document id: the id IS `${memberId}_${date}`, so a range on it is one member's date range
    // with no composite index to forget in production.
    const col = this.col(ctx.studioId, 'energyDays')
    const snap = await col
      .where('__name__', '>=', col.doc(energyDayId(memberId, from)))
      .where('__name__', '<=', col.doc(energyDayId(memberId, to)))
      .get()
    return snap.docs.map((d) => dayFrom(d.id, d.data()))
  }
  async saveDay(ctx: TenantContext, day: EnergyDay, events: readonly NewEvent[]): Promise<void> {
    const sid = ctx.studioId
    await this.db.runTransaction(async (tx) => {
      tx.set(this.col(sid, 'energyDays').doc(day.id), dayTo(day))
      this.writeEvents(sid, tx, events)
    })
  }
}
