import { FieldValue, Timestamp, type DocumentData } from 'firebase-admin/firestore'

import {
  instant,
  newEventId,
  type ActorRef,
  type BranchId,
  type Category,
  type ClassSessionId,
  type EntitlementId,
  type EventId,
  type Instant,
  type MemberId,
  type NewEvent,
  type ReservationId,
  type StudioId,
} from '../../../shared'
import type { MemberSnapshot } from '../../members'
import type {
  AttendanceSource,
  CreditEffect,
  Reservation,
  ReservationPolicyRef,
  ReservationStatus,
} from '../domain/types'

const toTs = (i: Instant): Timestamp => Timestamp.fromMillis(i)
const fromTs = (t: Timestamp): Instant => instant(t.toMillis())
const toTsN = (i: Instant | null): Timestamp | null => (i === null ? null : toTs(i))

export function reservationToFirestore(r: Reservation): DocumentData {
  return {
    studioId: r.studioId,
    branchId: r.branchId,
    classSessionId: r.classSessionId,
    memberId: r.memberId,
    entitlementId: r.entitlementId,
    status: r.status,
    creditEffect: r.creditEffect,
    sessionStartsAt: toTs(r.sessionStartsAt),
    sessionEndsAt: toTs(r.sessionEndsAt),
    sessionCategory: r.sessionCategory,
    memberSnapshot: r.memberSnapshot,
    bookedAt: toTs(r.bookedAt),
    bookedBy: r.bookedBy,
    resolvedAt: toTsN(r.resolvedAt),
    resolvedBy: r.resolvedBy,
    attendanceSource: r.attendanceSource,
    policyRef: r.policyRef,
    updatedAt: FieldValue.serverTimestamp(),
  }
}

export function reservationFromFirestore(id: ReservationId, d: DocumentData): Reservation {
  const resolvedAt = d.resolvedAt as Timestamp | null
  return {
    id,
    studioId: d.studioId as StudioId,
    branchId: d.branchId as BranchId,
    classSessionId: d.classSessionId as ClassSessionId,
    memberId: d.memberId as MemberId,
    entitlementId: d.entitlementId as EntitlementId,
    status: d.status as ReservationStatus,
    creditEffect: d.creditEffect as CreditEffect,
    sessionStartsAt: fromTs(d.sessionStartsAt as Timestamp),
    sessionEndsAt: fromTs(d.sessionEndsAt as Timestamp),
    sessionCategory: d.sessionCategory as Category,
    memberSnapshot: d.memberSnapshot as MemberSnapshot,
    bookedAt: fromTs(d.bookedAt as Timestamp),
    bookedBy: d.bookedBy as ActorRef,
    resolvedAt: resolvedAt ? fromTs(resolvedAt) : null,
    resolvedBy: (d.resolvedBy as ActorRef | null) ?? null,
    attendanceSource: (d.attendanceSource as AttendanceSource | null) ?? null,
    policyRef: d.policyRef as ReservationPolicyRef,
  }
}

export function eventToFirestore(e: NewEvent): { id: EventId; data: DocumentData } {
  const id = newEventId()
  return { id, data: { ...e, occurredAt: toTs(e.occurredAt), recordedAt: FieldValue.serverTimestamp() } }
}
