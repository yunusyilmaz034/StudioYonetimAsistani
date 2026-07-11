import { FieldValue, Timestamp, type DocumentData } from 'firebase-admin/firestore'

import {
  instant,
  newEventId,
  type ActorRef,
  type BranchId,
  type CheckInId,
  type EventId,
  type Instant,
  type MemberId,
  type NewEvent,
  type StudioId,
} from '../../../shared'
import type {
  BranchOccupancy,
  CheckIn,
  CheckInDirection,
  CheckInMethod,
  Presence,
} from '../domain/types'

const toTs = (i: Instant): Timestamp => Timestamp.fromMillis(i)
const fromTs = (t: Timestamp): Instant => instant(t.toMillis())

export function checkInToFirestore(c: CheckIn): DocumentData {
  return {
    studioId: c.studioId,
    memberId: c.memberId,
    branchId: c.branchId,
    direction: c.direction,
    method: c.method,
    occurredAt: toTs(c.occurredAt),
    actor: c.actor,
    recordedAt: FieldValue.serverTimestamp(),
  }
}

export function checkInFromFirestore(id: CheckInId, d: DocumentData): CheckIn {
  return {
    id,
    studioId: d.studioId as StudioId,
    memberId: d.memberId as MemberId,
    branchId: d.branchId as BranchId,
    direction: d.direction as CheckInDirection,
    method: d.method as CheckInMethod,
    occurredAt: fromTs(d.occurredAt as Timestamp),
    actor: d.actor as ActorRef,
  }
}

export function presenceToFirestore(p: Presence): DocumentData {
  return { memberId: p.memberId, branchId: p.branchId, checkedInAt: toTs(p.checkedInAt) }
}
export function presenceFromFirestore(d: DocumentData): Presence {
  return {
    memberId: d.memberId as MemberId,
    branchId: d.branchId as BranchId,
    checkedInAt: fromTs(d.checkedInAt as Timestamp),
  }
}

// Merge-only occupancy fields — never clobbers a branch name written elsewhere.
export function branchOccupancyToFirestore(b: BranchOccupancy): DocumentData {
  return { isOpen: b.isOpen, openedAt: b.openedAt === null ? null : toTs(b.openedAt) }
}
export function branchOccupancyFromFirestore(branchId: BranchId, d: DocumentData): BranchOccupancy {
  const openedAt = d.openedAt as Timestamp | null | undefined
  return { branchId, isOpen: d.isOpen === true, openedAt: openedAt ? fromTs(openedAt) : null }
}

export function eventToFirestore(e: NewEvent): { id: EventId; data: DocumentData } {
  const id = newEventId()
  return {
    id,
    data: { ...e, occurredAt: toTs(e.occurredAt), recordedAt: FieldValue.serverTimestamp() },
  }
}
