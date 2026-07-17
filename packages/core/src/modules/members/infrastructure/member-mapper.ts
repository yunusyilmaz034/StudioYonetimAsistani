import { FieldValue, Timestamp, type DocumentData } from 'firebase-admin/firestore'

import {
  instant,
  newEventId,
  type BranchId,
  type EventId,
  type Instant,
  type MemberId,
  type NewEvent,
  type StudioId,
} from '../../../shared'
import type {
  Email,
  EmergencyContact,
  Member,
  MemberRestriction,
  MemberStats,
  MemberStatus,
  PhoneE164,
} from '../domain/member'
import type { ErasureReason } from '../events'

// The domain never sees a Firestore document id (decision #2): the repository uses
// the MemberId string as the document id, and this mapper reconstructs a MemberId
// from that id on read. The domain never sees a Firestore Timestamp either.

const toTs = (i: Instant): Timestamp => Timestamp.fromMillis(i)
const fromTs = (t: Timestamp): Instant => instant(t.toMillis())
const nullableToTs = (i: Instant | null): Timestamp | null => (i === null ? null : toTs(i))
const nullableFromTs = (t: Timestamp | null): Instant | null => (t === null ? null : fromTs(t))

export function memberToFirestore(m: Member): DocumentData {
  return {
    studioId: m.studioId,
    homeBranchId: m.homeBranchId,
    fullName: m.fullName,
    phone: m.phone,
    phoneNormalized: m.phoneNormalized,
    email: m.email,
    birthDate: m.birthDate,
    notes: m.notes,
    emergencyContact: m.emergencyContact,
    status: m.status,
    joinedAt: toTs(m.joinedAt),
    stats: {
      lastAttendanceAt: nullableToTs(m.stats.lastAttendanceAt),
      lastCheckInAt: nullableToTs(m.stats.lastCheckInAt),
      lastBookingAt: nullableToTs(m.stats.lastBookingAt),
      totalAttended: m.stats.totalAttended,
      activeEntitlementCount: m.stats.activeEntitlementCount,
      balanceDue: m.stats.balanceDue,
    },
    // "Kısıtlı Üyelik" (Plus Phase 3) — the override rules + reason + note. Plain data; round-trips.
    restriction: m.restriction,
    // The tombstone (AD-67). Written only when she has been erased — and it must ROUND-TRIP, or the
    // erasure stops being idempotent: a second run would not see that she was already forgotten and
    // would write a second `member.erased` event, making one act read as two in the audit.
    ...(m.erased
      ? {
          erased: {
            at: toTs(m.erased.at),
            reason: m.erased.reason,
            note: m.erased.note,
          },
        }
      : {}),
    updatedAt: FieldValue.serverTimestamp(),
  }
}

export function memberFromFirestore(id: MemberId, data: DocumentData): Member {
  const stats = data.stats as DocumentData
  const memberStats: MemberStats = {
    lastAttendanceAt: nullableFromTs((stats.lastAttendanceAt as Timestamp | null) ?? null),
    lastCheckInAt: nullableFromTs((stats.lastCheckInAt as Timestamp | null) ?? null),
    lastBookingAt: nullableFromTs((stats.lastBookingAt as Timestamp | null) ?? null),
    totalAttended: stats.totalAttended as number,
    activeEntitlementCount: stats.activeEntitlementCount as number,
    balanceDue: stats.balanceDue as number,
  }
  return {
    id,
    studioId: data.studioId as StudioId,
    homeBranchId: (data.homeBranchId as BranchId | null) ?? null,
    fullName: data.fullName as string,
    phone: data.phone as PhoneE164,
    phoneNormalized: data.phoneNormalized as string,
    email: (data.email as Email | null) ?? null,
    birthDate: (data.birthDate as Member['birthDate']) ?? null,
    notes: (data.notes as string | null) ?? null,
    emergencyContact: (data.emergencyContact as EmergencyContact | null) ?? null,
    status: data.status as MemberStatus,
    joinedAt: fromTs(data.joinedAt as Timestamp),
    stats: memberStats,
    restriction: (data.restriction as MemberRestriction | null | undefined) ?? null,
    ...(data.erased
      ? {
          erased: {
            at: fromTs((data.erased as DocumentData).at as Timestamp),
            reason: (data.erased as DocumentData).reason as ErasureReason,
            note: ((data.erased as DocumentData).note as string | null) ?? null,
          },
        }
      : {}),
  }
}

// A pure decision returns NewEvent[]; here infrastructure assigns the id (a ULID)
// and recordedAt (serverTimestamp), and maps occurredAt to a Timestamp.
export function eventToFirestore(e: NewEvent): { id: EventId; data: DocumentData } {
  const id = newEventId()
  return {
    id,
    data: {
      ...e,
      occurredAt: toTs(e.occurredAt),
      recordedAt: FieldValue.serverTimestamp(),
    },
  }
}
