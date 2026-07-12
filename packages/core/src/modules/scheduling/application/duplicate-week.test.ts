import { describe, expect, it } from 'vitest'

import { instant, type BranchId, type ClassSessionId, type RoomId, type ServiceId, type StudioId } from '../../../shared'
import type { ClassSession, SessionPolicySnapshot } from '../domain/types'
import { computeDuplicationPlan } from './duplicate-week'

const WEEK = 7 * 86_400_000
const OFFSET = 180

const POLICY: SessionPolicySnapshot = {
  maxDaysInAdvance: 30,
  cancellationWindowHours: 6,
  cancellationWindowSource: 'service' as const,
  lateCancellationConsumesCredit: true,
  noShowConsumesCredit: true,
  attendanceDefaultOutcome: 'attended',
  autoResolveAfterMinutes: 180,
  allowMemberSelfBooking: false,
}

const SRC = 2_000_000_000_000 // a Monday 09:33 UTC — exact value irrelevant, shifts are by whole weeks

function makeSession(o: Partial<ClassSession> = {}): ClassSession {
  return {
    id: 'ses_src' as ClassSessionId,
    studioId: 'std_1' as StudioId,
    branchId: 'brn_1' as BranchId,
    serviceId: 'svc_1' as ServiceId,
    roomId: 'rom_1' as RoomId,
    trainerId: null,
    templateId: null,
    assignedMemberId: null,
    category: 'pilates_group',
    startsAt: instant(SRC),
    endsAt: instant(SRC + 3_600_000),
    capacity: 8,
    status: 'scheduled',
    cancellation: null,
    policyRef: { serviceId: 'svc_1' as ServiceId, version: 1 },
    policySnapshot: POLICY,
    bookedCount: 0,
    attendedCount: 0,
    serviceName: 'Reformer',
    roomName: 'Salon A',
    trainerName: null,
    branchName: 'Merkez',
    ...o,
  }
}

describe('computeDuplicationPlan', () => {
  it('copies a scheduled session into N future weeks, preserving room/capacity and shifting by a week', () => {
    const plan = computeDuplicationPlan([makeSession()], [], 4, SRC - 1000, OFFSET)
    expect(plan.toCreate).toHaveLength(4)
    expect(plan.conflicts).toHaveLength(0)
    expect(plan.skippedPast).toHaveLength(0)
    expect(plan.toCreate.map((t) => t.startsAt)).toEqual([SRC + WEEK, SRC + 2 * WEEK, SRC + 3 * WEEK, SRC + 4 * WEEK])
    expect(plan.toCreate[0]?.capacity).toBe(8)
    expect(plan.toCreate[0]?.roomId).toBe('rom_1')
    expect(plan.toCreate[0]?.durationMinutes).toBe(60)
  })

  it('never generates into the past', () => {
    // now is after weeks 1 and 2 → only weeks 3 and 4 are created.
    const plan = computeDuplicationPlan([makeSession()], [], 4, SRC + 2 * WEEK + 1, OFFSET)
    expect(plan.skippedPast).toHaveLength(2)
    expect(plan.toCreate.map((t) => t.weekOffset)).toEqual([3, 4])
  })

  it('flags a conflict when a session already exists at the same room + start time (no overwrite)', () => {
    const existing = makeSession({ id: 'ses_x' as ClassSessionId, startsAt: instant(SRC + WEEK), endsAt: instant(SRC + WEEK + 3_600_000) })
    const plan = computeDuplicationPlan([makeSession()], [existing], 2, SRC - 1000, OFFSET)
    expect(plan.conflicts.map((t) => t.weekOffset)).toEqual([1])
    expect(plan.toCreate.map((t) => t.weekOffset)).toEqual([2])
  })

  it('does not copy a cancelled source session', () => {
    const plan = computeDuplicationPlan([makeSession({ status: 'cancelled' })], [], 4, SRC - 1000, OFFSET)
    expect(plan.toCreate).toHaveLength(0)
  })

  it('uses a service+time conflict key for a room-less session', () => {
    const src = makeSession({ roomId: null, roomName: null })
    const existing = makeSession({ id: 'ses_y' as ClassSessionId, roomId: null, startsAt: instant(SRC + WEEK), endsAt: instant(SRC + WEEK + 3_600_000) })
    const plan = computeDuplicationPlan([src], [existing], 2, SRC - 1000, OFFSET)
    expect(plan.conflicts.map((t) => t.weekOffset)).toEqual([1])
  })
})
