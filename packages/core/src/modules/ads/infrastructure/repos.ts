import { FieldValue, getFirestore, Timestamp, type DocumentData, type Firestore } from 'firebase-admin/firestore'

import { money, newEventId, type DomainError, type Instant, type NewEvent, type Result, type StudioId, type TenantContext } from '../../../shared'
import type { AdCampaign } from '../domain/types'
import type { AdCaps } from '../events'

// `studios/{sid}/adCampaigns/{adc_…}` — server-only (rules). Every change runs in a TRANSACTION that
// re-reads the campaign, decides, and writes state + events together (#1). That is what makes
// `publishing` a real lock: two presses race to the same document and only one wins.

const ms = (v: unknown): number => (v instanceof Timestamp ? v.toMillis() : Number(v ?? 0))

function toDoc(c: AdCampaign): DocumentData {
  return {
    ...c,
    createdAt: Timestamp.fromMillis(c.createdAt as number),
    approvedAt: c.approvedAt == null ? null : Timestamp.fromMillis(c.approvedAt as number),
  }
}

function fromDoc(id: string, d: DocumentData): AdCampaign {
  return {
    ...(d as AdCampaign),
    id,
    createdAt: ms(d.createdAt) as Instant,
    approvedAt: d.approvedAt == null ? null : (ms(d.approvedAt) as Instant),
  }
}

export class FirestoreAdsRepository {
  constructor(private readonly db: Firestore = getFirestore()) {}

  private col(sid: StudioId) {
    return this.db.collection('studios').doc(sid).collection('adCampaigns')
  }

  private writeEvents(sid: StudioId, events: readonly NewEvent[], set: (ref: FirebaseFirestore.DocumentReference, data: DocumentData) => void) {
    for (const e of events) {
      set(this.db.collection('studios').doc(sid).collection('events').doc(newEventId()), {
        ...e,
        occurredAt: Timestamp.fromMillis(e.occurredAt as number),
        recordedAt: FieldValue.serverTimestamp(),
      })
    }
  }

  /** The studio's spending caps — DATA (owner: 300 TL/day, 6.000 TL/campaign). None set → no ad can be proposed. */
  async caps(ctx: TenantContext): Promise<AdCaps | null> {
    const d = (await this.db.doc(`studios/${ctx.studioId}/settings/ads`).get()).data()
    const daily = Number(d?.dailyCapKurus)
    const campaign = Number(d?.campaignCapKurus)
    if (!Number.isInteger(daily) || daily <= 0 || !Number.isInteger(campaign) || campaign <= 0) return null
    return { dailyCap: money(daily), campaignCap: money(campaign) }
  }

  async get(ctx: TenantContext, id: string): Promise<AdCampaign | null> {
    const s = await this.col(ctx.studioId).doc(id).get()
    const d = s.data()
    return d ? fromDoc(s.id, d) : null
  }

  async list(ctx: TenantContext): Promise<readonly AdCampaign[]> {
    const snap = await this.col(ctx.studioId).orderBy('createdAt', 'desc').limit(50).get()
    return snap.docs.map((d) => fromDoc(d.id, d.data())).filter((c) => c.status !== 'removed')
  }

  async create(ctx: TenantContext, c: AdCampaign, events: readonly NewEvent[]): Promise<void> {
    const batch = this.db.batch()
    batch.create(this.col(ctx.studioId).doc(c.id), toDoc(c))
    this.writeEvents(ctx.studioId, events, (ref, data) => batch.set(ref, data))
    await batch.commit()
  }

  /** Read → decide → write, atomically. The decision sees the campaign as it is at commit time. */
  async mutate(
    ctx: TenantContext,
    id: string,
    decide: (current: AdCampaign) => Result<{ next: AdCampaign; events: readonly NewEvent[] }, DomainError>,
  ): Promise<Result<AdCampaign, DomainError>> {
    const ref = this.col(ctx.studioId).doc(id)
    return this.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref)
      const d = snap.data()
      if (!d) return { ok: false as const, error: { code: 'operation_not_applicable' as const } }
      const r = decide(fromDoc(snap.id, d))
      if (!r.ok) return r
      if (r.value.events.length === 0) return { ok: true as const, value: r.value.next }
      tx.set(ref, toDoc(r.value.next))
      this.writeEvents(ctx.studioId, r.value.events, (eref, data) => tx.set(eref, data))
      return { ok: true as const, value: r.value.next }
    })
  }
}
