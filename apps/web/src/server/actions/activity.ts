'use server'

import { z } from 'zod'

import { FirestoreMemberRepository } from '@studio/core'

import { requireTenantContext } from '../auth'
import { adminDb } from '../firebase-admin'
import {
  loadAudit,
  loadFeed,
  loadMemberTimeline,
  loadOperationEvents,
  loadPackageTimeline,
  loadReservationTimeline,
  type ActivityEvent,
  type ActivityKind,
  type ActivityPage,
} from '../activity-query'

// The Operations Center's only door (Doc 23, OQ-1 — owner, 2026-07-13).
//
// The Firestore rule on /events stays OWNER-ONLY: reception never reads a raw event through the
// client SDK, ever. Every screen comes through here, and the role filter is applied on the SERVER
// (`visibleKinds` in activity-query.ts). This file is the entire blast radius.
const STAFF = ['owner', 'receptionist', 'trainer', 'platform_admin'] as const
const OWNER = ['owner', 'platform_admin'] as const

const KINDS = [
  'reservation',
  'membership',
  'payment',
  'credit',
  'checkin',
  'operation',
  'schedule',
  'system',
] as const

const feedSchema = z.object({
  kinds: z.array(z.enum(KINDS)).default([]),
  memberId: z.string().min(1).optional(),
  actorId: z.string().min(1).optional(),
  fromMs: z.number().optional(),
  toMs: z.number().optional(),
  cursor: z.string().nullable().default(null),
})

export async function loadFeedAction(input: unknown): Promise<ActivityPage> {
  const p = feedSchema.parse(input)
  const ctx = await requireTenantContext(STAFF)
  return loadFeed(ctx, {
    kinds: p.kinds as readonly ActivityKind[],
    ...(p.memberId ? { memberId: p.memberId } : {}),
    ...(p.actorId ? { actorId: p.actorId } : {}),
    ...(p.fromMs ? { fromMs: p.fromMs } : {}),
    ...(p.toMs ? { toMs: p.toMs } : {}),
    cursor: p.cursor,
  })
}

export interface SearchResolution {
  readonly kind: 'member' | 'operation' | 'none'
  readonly memberId?: string
  readonly memberName?: string
  readonly operationId?: string
}

// D28 — search. The log cannot be searched by name or phone, because **it contains neither** (#6).
// So a text search is resolved against /members FIRST, producing an id, and only then is the log
// queried by that id. This is not a limitation to work around; it is the property that lets us
// erase a member and keep her history as anonymous behaviour.
export async function resolveSearchAction(input: unknown): Promise<SearchResolution> {
  const p = z.object({ query: z.string().trim().min(1) }).parse(input)
  const ctx = await requireTenantContext(STAFF)
  const q = p.query

  // An OperationId is an id — searched directly.
  if (/^cor_[A-Z0-9]+$/i.test(q)) return { kind: 'operation', operationId: q }

  const members = await new FirestoreMemberRepository(adminDb()).list(ctx)
  const needle = q.toLocaleLowerCase('tr')
  const digits = q.replace(/\D/g, '')
  const hit = members.find(
    (m) =>
      m.fullName.toLocaleLowerCase('tr').includes(needle) ||
      (digits.length >= 4 && (m.phone as string).includes(digits)),
  )
  return hit
    ? { kind: 'member', memberId: hit.id as string, memberName: hit.fullName }
    : { kind: 'none' }
}

export async function memberTimelineAction(input: unknown): Promise<readonly ActivityEvent[]> {
  const p = z.object({ memberId: z.string().min(1) }).parse(input)
  return loadMemberTimeline(await requireTenantContext(STAFF), p.memberId)
}

export async function reservationTimelineAction(input: unknown): Promise<readonly ActivityEvent[]> {
  const p = z.object({ reservationId: z.string().min(1) }).parse(input)
  return loadReservationTimeline(await requireTenantContext(STAFF), p.reservationId)
}

export async function packageTimelineAction(input: unknown): Promise<readonly ActivityEvent[]> {
  const p = z.object({ entitlementId: z.string().min(1) }).parse(input)
  return loadPackageTimeline(await requireTenantContext(STAFF), p.entitlementId)
}

// Every event ONE operation wrote. This is the query OP-2 exists for.
export async function operationEventsAction(input: unknown): Promise<readonly ActivityEvent[]> {
  const p = z.object({ operationId: z.string().min(1) }).parse(input)
  return loadOperationEvents(await requireTenantContext(STAFF), p.operationId)
}

// The Audit Log — owner only (owner, 2026-07-13). The record of who changed the world must not be
// governed by the people it records.
export async function auditAction(input: unknown): Promise<ActivityPage> {
  const p = z.object({ cursor: z.string().nullable().default(null) }).parse(input)
  return loadAudit(await requireTenantContext(OWNER), { cursor: p.cursor })
}
