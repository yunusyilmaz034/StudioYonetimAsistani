import {
  FirestoreIdentityRepository,
  FirestoreMemberRepository,
  undoPolicyOf,
  type TenantContext,
  type UndoPolicy,
} from '@studio/core'
import { Timestamp, type CollectionReference, type Query } from 'firebase-admin/firestore'

import { adminDb } from './firebase-admin'

// ── The Operations Center's read layer (Doc 23). ────────────────────────────────────────────
//
// Six screens, ONE source: the append-only event log. No projection is built (Phase 2), because
// an indexed, correlated log already answers every question these screens ask — in one query.
//
// Two rules this file exists to enforce, and they are the owner's (2026-07-13):
//
//   1. **The client never reads /events.** The Firestore rule stays owner-only; every screen is
//      fed from here, and the role filter is applied ON THE SERVER. Reception sees the
//      operational event kinds; the owner sees everything.
//   2. **Events carry no PII (#6).** `memberId` is an opaque id. Names are joined in at render
//      time from /members and /staff, in ONE batched read for the whole page. That is not a
//      workaround — it is what lets us erase a member and keep her behaviour as anonymous history.

const EVENT_LIMIT = 50

export type ActivityKind =
  | 'reservation'
  | 'membership'
  | 'payment'
  | 'credit'
  | 'checkin'
  | 'feedback' // a member left training feedback, or a trainer answered it
  | 'notification' // message delivery (sent/delivered) — kept for the audit log, OFF the live feed
  | 'operation'
  | 'schedule'
  | 'system'

// Which event types belong to which business kind. The FILTER the owner asked for
// (Rezervasyonlar · Üyelikler · Ödemeler · Toplu İşlemler · Check-in · QR · Sistem) is expressed
// here, once — not re-derived per screen.
export const KIND_OF: Record<string, ActivityKind> = {
  'reservation.booked': 'reservation',
  'reservation.cancelled': 'reservation',
  'reservation.late_cancelled': 'reservation',
  'reservation.moved': 'reservation',
  'reservation.attended': 'reservation',
  'reservation.no_show': 'reservation',
  'reservation.auto_resolved': 'system',
  'reservation.corrected': 'reservation',
  'reservation.note_set': 'reservation',
  'waitlist.joined': 'reservation',
  'waitlist.left': 'reservation',
  'waitlist.promoted': 'reservation',

  'member.registered': 'membership',
  'member.profile_updated': 'membership',
  'member.deactivated': 'membership',
  'member.invited': 'membership',
  'member.portal_activated': 'membership',
  'member.portal_login': 'system',

  'member.checked_in': 'checkin',
  'member.checked_out': 'checkin',
  'member.auto_checked_out': 'system',

  // ── training feedback (owner: "geri bildirimler akışta olsun") ──
  'training_feedback.left': 'feedback',
  'training_feedback.answered': 'feedback',
  'training_feedback.resolved': 'system',

  'entitlement.purchased': 'membership',
  'entitlement.payment_recorded': 'payment',
  'entitlement.credit_held': 'credit',
  'entitlement.credit_released': 'credit',
  'entitlement.credit_consumed': 'credit',
  'entitlement.credit_restored': 'credit',
  'entitlement.adjusted': 'credit',
  'entitlement.extended': 'credit',
  'entitlement.amended': 'membership',
  'entitlement.cancelled': 'membership',
  'entitlement.reactivated': 'membership',
  'entitlement.exhausted': 'system',
  'entitlement.expired': 'system',

  // ── finance (v1.24) ──
  'sale.created': 'payment',
  'sale.cancelled': 'payment',
  'sale.settled': 'payment',
  'payment.received': 'payment',
  'payment.voided': 'payment',
  'payment.refunded': 'payment',
  'allocation.applied': 'payment',
  'drawer.created': 'operation',
  'drawer.opened': 'operation',
  'drawer.closed': 'operation',
  'drawer.discrepancy_recorded': 'operation',
  'giftcard.issued': 'payment',
  'giftcard.redeemed': 'payment',
  'coupon.created': 'system',
  'coupon.redeemed': 'payment',
  'plan.created': 'payment',
  'plan.instalment_paid': 'payment',
  'plan.cancelled': 'payment',
  // ── notifications (v1.25) ──
  // The member-facing outcomes are business events (owner: "üye bildirimleri akışta olsun"); the
  // internal plumbing (intent/queue/retry/suppress) stays 'system' noise, off the live feed.
  'notification.intent_created': 'system',
  'notification.queued': 'system',
  'notification.sent': 'notification',
  'notification.delivered': 'notification',
  'notification.failed': 'notification',
  'notification.suppressed': 'system',
  'notification.retried': 'system',
  'entitlement.expiring': 'system',
  'entitlement.credits_low': 'system',
  'system.operation_failed': 'system',
  'system.error': 'system',
  // ── CRM (v1.24) ──
  'lead.captured': 'membership',
  'lead.stage_changed': 'membership',
  'lead.lost': 'membership',
  'lead.converted': 'membership',
  'interaction.logged': 'membership',
  'offer.created': 'payment',
  'offer.sent': 'payment',
  'offer.accepted': 'payment',
  'offer.rejected': 'payment',
  'member.churned': 'membership',

  'studio_closure.planned': 'operation',
  'studio_closure.applied': 'operation',
  'studio_closure.cancelled': 'operation',
  'bulk_operation.planned': 'operation',
  'bulk_operation.applied': 'operation',
  'studio_calendar.day_marked': 'operation',
  'studio_calendar.day_updated': 'operation',
  'studio_calendar.day_removed': 'operation',
  'studio_calendar.imported': 'operation',

  'class_session.scheduled': 'schedule',
  'class_session.cancelled': 'schedule',
  'class_session.capacity_changed': 'schedule',
  'class_session.room_changed': 'schedule',
  'class_session.trainer_changed': 'schedule',
  'class_session.assigned': 'schedule',
  'class_session.note_set': 'schedule',
  'class_template.created': 'schedule',
  'class_template.updated': 'schedule',
  'class_template.deactivated': 'schedule',

  'product.created': 'system',
  'product.updated': 'system',
  'service.created': 'system',
  'service.updated': 'system',
  'service.deactivated': 'system',
  'service.reactivated': 'system',
  'service.policy_published': 'system',
  'room.created': 'system',
  'room.updated': 'system',
  'room.deactivated': 'system',
  'room.reactivated': 'system',
  'branch.opened': 'system',
  'branch.closed': 'system',
  'studio.settings_updated': 'system',
}

export const kindOf = (type: string): ActivityKind => KIND_OF[type] ?? 'system'

// The raw event, as the presenter needs it. Still no sentence — that is the presenter's job, and
// it runs in the browser so the same row can be re-rendered without a round trip.
export interface ActivityEvent {
  readonly eventId: string
  readonly type: string
  readonly kind: ActivityKind
  readonly occurredAt: number
  readonly recordedAt: number
  readonly actorType: string
  readonly actorId: string
  readonly actorName: string
  readonly memberId: string | null
  readonly memberName: string | null
  readonly operationId: string
  readonly undoPolicy: UndoPolicy
  readonly payload: Record<string, unknown>
  readonly related: {
    readonly reservationId?: string
    readonly entitlementId?: string
    readonly classSessionId?: string
  }
}

export interface ActivityPage {
  readonly entries: readonly ActivityEvent[]
  readonly nextCursor: string | null
}

// The event kinds reception may see. The owner sees everything — including the Audit Log, which is
// hers alone (owner, 2026-07-13). Reception's day does not need the price list's edit history.
const RECEPTION_KINDS: readonly ActivityKind[] = [
  'reservation',
  'membership',
  'payment',
  'credit',
  'checkin',
  'feedback',
  'notification',
  'operation',
  'schedule',
]

const visibleKinds = (ctx: TenantContext): readonly ActivityKind[] =>
  ctx.role === 'owner'
    ? ['reservation', 'membership', 'payment', 'credit', 'checkin', 'feedback', 'notification', 'operation', 'schedule', 'system']
    : RECEPTION_KINDS

// The DASHBOARD live feed (the hover menu) — a quick glance at what MEMBERS are DOING right now, not
// the audit log. Owner (2026-07-18, tightened): exactly three things belong here — a member's
// reservation actions, her QR check-in, and her training feedback. Nothing else: sales/collections
// ("satış tahsil edildi"), membership edits, notifications, schedule, operations — all plumbing or
// back-office, all OFF the feed. The /activity audit log still carries everything for the owner.
export const FEED_KINDS: readonly ActivityKind[] = [
  'reservation',
  'checkin',
  'feedback',
]

// ── the name resolver ───────────────────────────────────────────────────────────────────────
// One batched read per page, whatever the row count. A page of 50 rows touching 12 members costs
// two round trips, not fifty-one.
async function resolveNames(
  ctx: TenantContext,
  memberIds: ReadonlySet<string>,
): Promise<{ members: Map<string, string>; staff: Map<string, string> }> {
  const db = adminDb()
  const [members, staff] = await Promise.all([
    memberIds.size === 0
      ? Promise.resolve([])
      : new FirestoreMemberRepository(db).list(ctx), // the studio's member list is small and cached-friendly
    new FirestoreIdentityRepository(db).listStaff(ctx),
  ])
  return {
    members: new Map(members.map((m) => [m.id as string, m.fullName])),
    staff: new Map(staff.map((s) => [s.id as string, s.displayName])),
  }
}

const ACTOR_FALLBACK: Record<string, string> = {
  system: 'Sistem',
  member: 'Üye',
  owner: 'Yönetici',
  receptionist: 'Resepsiyon',
  trainer: 'Eğitmen',
  platform_admin: 'Platform',
}

async function hydrate(
  ctx: TenantContext,
  docs: readonly FirebaseFirestore.QueryDocumentSnapshot[],
): Promise<readonly ActivityEvent[]> {
  const memberIds = new Set<string>()
  for (const d of docs) {
    const related = (d.get('related') ?? {}) as { memberId?: string }
    if (related.memberId) memberIds.add(related.memberId)
  }
  const names = await resolveNames(ctx, memberIds)

  return docs.map((d) => {
    const data = d.data()
    const related = (data.related ?? {}) as ActivityEvent['related'] & { memberId?: string }
    const actor = (data.actor ?? {}) as { type?: string; id?: string }
    const type = data.type as string
    const memberId = related.memberId ?? null
    return {
      eventId: d.id,
      type,
      kind: kindOf(type),
      occurredAt: toMs(data.occurredAt),
      recordedAt: toMs(data.recordedAt),
      actorType: actor.type ?? 'system',
      actorId: actor.id ?? '',
      // A staff name if we have one; otherwise the principal's role in Turkish — never a raw id,
      // and never a blank.
      actorName:
        names.staff.get(actor.id ?? '') ?? ACTOR_FALLBACK[actor.type ?? 'system'] ?? 'Sistem',
      memberId,
      // A member erased under KVKK leaves her behaviour behind, without her name. Say so.
      memberName: memberId ? (names.members.get(memberId) ?? 'Silinmiş üye') : null,
      operationId: (data.correlationId as string) ?? '',
      undoPolicy: undoPolicyOf(type),
      payload: (data.payload ?? {}) as Record<string, unknown>,
      related: {
        ...(related.reservationId ? { reservationId: related.reservationId } : {}),
        ...(related.entitlementId ? { entitlementId: related.entitlementId } : {}),
        ...(related.classSessionId ? { classSessionId: related.classSessionId } : {}),
      },
    }
  })
}

const toMs = (v: unknown): number =>
  v instanceof Timestamp ? v.toMillis() : typeof v === 'number' ? v : 0

const events = (ctx: TenantContext): CollectionReference =>
  adminDb().collection('studios').doc(ctx.studioId).collection('events')

// ── the five queries ────────────────────────────────────────────────────────────────────────

export interface FeedFilter {
  readonly kinds?: readonly ActivityKind[]
  readonly memberId?: string
  readonly actorId?: string
  readonly fromMs?: number
  readonly toMs?: number
  readonly cursor?: string | null
}

// The Activity Feed. Newest first, by SERVER time — an offline check-in that happened at 08:00 and
// arrived at 09:00 belongs where it arrived, or the feed would rewrite itself under reception's
// cursor. (`occurredAt` is still shown on the row: OP-1 shows both.)
export async function loadFeed(ctx: TenantContext, filter: FeedFilter = {}): Promise<ActivityPage> {
  let q: Query = events(ctx).orderBy('recordedAt', 'desc')
  if (filter.memberId) q = q.where('related.memberId', '==', filter.memberId)
  if (filter.fromMs) q = q.where('recordedAt', '>=', Timestamp.fromMillis(filter.fromMs))
  if (filter.toMs) q = q.where('recordedAt', '<=', Timestamp.fromMillis(filter.toMs))
  if (filter.actorId) q = q.where('actor.id', '==', filter.actorId)
  if (filter.cursor) {
    const anchor = await events(ctx).doc(filter.cursor).get()
    if (anchor.exists) q = q.startAfter(anchor)
  }

  // The kind filter is applied in memory, on purpose: `type in [...]` costs an index per
  // combination and Firestore caps `in` at 30 values. We over-fetch a bounded page and cut it
  // here — the limit is server-set, never caller-set, so this can never become a scan.
  const allowed = new Set(filter.kinds && filter.kinds.length > 0 ? filter.kinds : visibleKinds(ctx))
  const snap = await q.limit(EVENT_LIMIT * 3).get()
  const visible = snap.docs.filter((d) => allowed.has(kindOf(d.get('type') as string)))
  const page = visible.slice(0, EVENT_LIMIT)

  return {
    entries: await hydrate(ctx, page),
    nextCursor: visible.length > EVENT_LIMIT ? (page.at(-1)?.id ?? null) : null,
  }
}

// A timeline: one aggregate's whole life, oldest LAST (newest first reads better on screen; the
// member workspace flips it when it wants a life story).
async function timeline(
  ctx: TenantContext,
  field: 'related.memberId' | 'related.reservationId' | 'related.entitlementId',
  id: string,
  limit = 200,
): Promise<readonly ActivityEvent[]> {
  const snap = await events(ctx)
    .where(field, '==', id)
    .orderBy('occurredAt', 'desc')
    .limit(limit)
    .get()
  const allowed = new Set(visibleKinds(ctx))
  return hydrate(
    ctx,
    snap.docs.filter((d) => allowed.has(kindOf(d.get('type') as string))),
  )
}

export const loadMemberTimeline = (ctx: TenantContext, memberId: string) =>
  timeline(ctx, 'related.memberId', memberId)

export const loadReservationTimeline = (ctx: TenantContext, reservationId: string) =>
  timeline(ctx, 'related.reservationId', reservationId, 50)

export const loadPackageTimeline = (ctx: TenantContext, entitlementId: string) =>
  timeline(ctx, 'related.entitlementId', entitlementId, 200)

// Everything ONE operation did. This is the query OP-2 exists for: a closure's 40 cancellations,
// 300 credit releases and 120 extensions, all under one id, in the order they happened.
export async function loadOperationEvents(
  ctx: TenantContext,
  operationId: string,
): Promise<readonly ActivityEvent[]> {
  const snap = await events(ctx)
    .where('correlationId', '==', operationId)
    .orderBy('occurredAt', 'asc')
    .limit(500)
    .get()
  return hydrate(ctx, snap.docs)
}

// The Audit Log — owner only, enforced by the Server Action. The types below are the ones where a
// HUMAN changed the world on purpose: corrections, credit adjustments, price and policy edits,
// closures, bulk acts, deactivations. A booking is not an audit event; a correction is.
export const AUDIT_TYPES: readonly string[] = [
  // finance: every discretionary movement — a discount, a void, a refund, a cash discrepancy —
  // is exactly what an audit log exists for.
  'sale.created',
  'sale.cancelled',
  'payment.voided',
  'payment.refunded',
  'drawer.closed',
  'drawer.discrepancy_recorded',
  'notification.failed',
  'giftcard.issued',
  'coupon.created',
  'lead.lost',
  'member.churned',
  'reservation.corrected',
  'entitlement.adjusted',
  'entitlement.extended',
  'entitlement.amended',
  'entitlement.cancelled',
  'entitlement.reactivated',
  'member.deactivated',
  'member.profile_updated',
  'product.created',
  'product.updated',
  'service.updated',
  'service.deactivated',
  'service.policy_published',
  'studio.settings_updated',
  'studio_closure.planned',
  'studio_closure.applied',
  'studio_closure.cancelled',
  'bulk_operation.planned',
  'bulk_operation.applied',
  'class_session.cancelled',
  'class_session.capacity_changed',
]

export async function loadAudit(
  ctx: TenantContext,
  filter: { cursor?: string | null } = {},
): Promise<ActivityPage> {
  let q: Query = events(ctx).orderBy('recordedAt', 'desc')
  if (filter.cursor) {
    const anchor = await events(ctx).doc(filter.cursor).get()
    if (anchor.exists) q = q.startAfter(anchor)
  }
  const audit = new Set(AUDIT_TYPES)
  const snap = await q.limit(EVENT_LIMIT * 4).get()
  const visible = snap.docs.filter((d) => audit.has(d.get('type') as string))
  const page = visible.slice(0, EVENT_LIMIT)
  return {
    entries: await hydrate(ctx, page),
    nextCursor: visible.length > EVENT_LIMIT ? (page.at(-1)?.id ?? null) : null,
  }
}
