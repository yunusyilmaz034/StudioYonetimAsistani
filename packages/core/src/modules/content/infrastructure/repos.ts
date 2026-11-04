import { FieldValue, getFirestore, Timestamp, type DocumentData, type Firestore } from 'firebase-admin/firestore'

import { newEventId, type ActorRef, type DomainError, type Instant, type NewEvent, type Result, type StudioId, type TenantContext } from '../../../shared'
import type { ContentRepository } from '../application/ports'
import type { ContentAiCheck, ContentMedia, ContentPost, ContentPublishState } from '../domain/types'

// `studios/{sid}/contentPosts/{id}` — server-only (Admin SDK); the panel reaches it through Server Actions.
// State and its events commit in ONE batch (#1).

const ms = (v: unknown): number => (v instanceof Timestamp ? v.toMillis() : Number(v ?? 0))

function toDoc(p: ContentPost): DocumentData {
  return {
    ...p,
    scheduledFor: Timestamp.fromMillis(p.scheduledFor as number),
    createdAt: Timestamp.fromMillis(p.createdAt as number),
    approvedAt: p.approvedAt == null ? null : Timestamp.fromMillis(p.approvedAt as number),
  }
}

function fromDoc(id: string, d: DocumentData): ContentPost {
  return {
    id,
    studioId: d.studioId as StudioId,
    weekStart: String(d.weekStart),
    scheduledFor: ms(d.scheduledFor) as Instant,
    format: d.format,
    origin: d.origin,
    title: String(d.title ?? ''),
    shotCard: {
      clips: (d.shotCard?.clips ?? []).map((c: DocumentData) => ({ seconds: Number(c.seconds), angle: String(c.angle ?? ''), what: String(c.what ?? '') })),
      hook: String(d.shotCard?.hook ?? ''),
      notes: String(d.shotCard?.notes ?? ''),
      music: String(d.shotCard?.music ?? ''),
    },
    caption: String(d.caption ?? ''),
    hashtags: Array.isArray(d.hashtags) ? d.hashtags.map(String) : [],
    status: d.status,
    createdAt: ms(d.createdAt) as Instant,
    createdBy: d.createdBy as ActorRef,
    approvedAt: d.approvedAt == null ? null : (ms(d.approvedAt) as Instant),
    approvedBy: (d.approvedBy ?? null) as ActorRef | null,
    consentConfirmed: Boolean(d.consentConfirmed),
    // IG-2b — nested instants are stored as epoch-ms numbers.
    media: (d.media ?? null) as ContentMedia | null,
    aiCheck: (d.aiCheck ?? null) as ContentAiCheck | null,
    publish: (d.publish ?? null) as ContentPublishState | null,
  }
}

export class FirestoreContentRepository implements ContentRepository {
  constructor(private readonly db: Firestore = getFirestore()) {}

  private col(sid: StudioId, name: string) {
    return this.db.collection('studios').doc(sid).collection(name)
  }

  async getPost(ctx: TenantContext, id: string): Promise<ContentPost | null> {
    const s = await this.col(ctx.studioId, 'contentPosts').doc(id).get()
    const d = s.data()
    return d ? fromDoc(s.id, d) : null
  }

  async listWeek(ctx: TenantContext, weekStart: string): Promise<readonly ContentPost[]> {
    const snap = await this.col(ctx.studioId, 'contentPosts').where('weekStart', '==', weekStart).get()
    return snap.docs.map((d) => fromDoc(d.id, d.data())).sort((a, b) => (a.scheduledFor as number) - (b.scheduledFor as number))
  }

  async listByStatus(ctx: TenantContext, status: ContentPost['status']): Promise<readonly ContentPost[]> {
    const snap = await this.col(ctx.studioId, 'contentPosts').where('status', '==', status).get()
    return snap.docs.map((d) => fromDoc(d.id, d.data()))
  }

  /** IG-2b: read → decide → write in ONE transaction — what makes `publishing` a real lock. */
  async mutatePost(
    ctx: TenantContext,
    id: string,
    decide: (current: ContentPost) => Result<{ next: ContentPost; events: readonly NewEvent[] }, DomainError>,
  ): Promise<Result<ContentPost, DomainError>> {
    const ref = this.col(ctx.studioId, 'contentPosts').doc(id)
    return this.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref)
      const d = snap.data()
      if (!d) return { ok: false as const, error: { code: 'operation_not_applicable' as const } }
      const r = decide(fromDoc(snap.id, d))
      if (!r.ok) return r
      if (r.value.events.length === 0) return { ok: true as const, value: r.value.next }
      tx.set(ref, toDoc(r.value.next))
      for (const e of r.value.events) {
        tx.set(this.col(ctx.studioId, 'events').doc(newEventId()), { ...e, occurredAt: Timestamp.fromMillis(e.occurredAt as number), recordedAt: FieldValue.serverTimestamp() })
      }
      return { ok: true as const, value: r.value.next }
    })
  }

  async savePosts(ctx: TenantContext, posts: readonly ContentPost[], events: readonly NewEvent[]): Promise<void> {
    if (posts.length === 0 && events.length === 0) return
    const batch = this.db.batch()
    for (const p of posts) batch.set(this.col(ctx.studioId, 'contentPosts').doc(p.id), toDoc(p))
    for (const e of events) {
      batch.set(this.col(ctx.studioId, 'events').doc(newEventId()), {
        ...e,
        occurredAt: Timestamp.fromMillis(e.occurredAt as number),
        recordedAt: FieldValue.serverTimestamp(),
      })
    }
    await batch.commit()
  }
}
