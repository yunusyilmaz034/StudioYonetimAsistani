import { describe, expect, it } from 'vitest'

import {
  decideCancelSession,
  decideCreateService,
  decideScheduleSession,
} from '../../src/modules/scheduling/domain/decide'
import type { DecideContext } from '../../src/modules/scheduling/domain/decide'
import type { ClassSession, SchedulingPolicy, Service } from '../../src/modules/scheduling/domain/types'
import {
  instant,
  type BranchId,
  type ClassSessionId,
  type CorrelationId,
  type RoomId,
  type ServiceId,
  type StaffUserId,
  type StudioId,
} from '../../src/shared'
import serviceCreated from './service.created.v1.json'
import sessionCancelled from './class_session.cancelled.v1.json'
import sessionScheduled from './class_session.scheduled.v1.json'

const ctx: DecideContext = {
  studioId: 'std_1' as StudioId,
  actor: { type: 'owner', id: 'usr_1' as StaffUserId },
  now: instant(1_700_000_000_000),
  correlationId: 'cor_1' as CorrelationId,
  source: 'reception_web',
}
const policy: SchedulingPolicy = {
  maxDaysInAdvance: 14,
  cancellationWindowHours: 6,
  lateCancellationConsumesCredit: true,
  noShowConsumesCredit: true,
  attendanceDefaultOutcome: 'attended',
  autoResolveAfterMinutes: 15,
}
const service: Service = {
  id: 'svc_1' as ServiceId,
  studioId: 'std_1' as StudioId,
  name: 'Reformer',
  category: 'pilates_group',
  policy,
  policyVersion: 1,
  active: true,
}
const session: ClassSession = {
  id: 'cls_1' as ClassSessionId,
  studioId: 'std_1' as StudioId,
  branchId: 'brn_1' as BranchId,
  serviceId: 'svc_1' as ServiceId,
  roomId: 'rom_1' as RoomId,
  trainerId: null,
  templateId: null,
  category: 'pilates_group',
  startsAt: instant(1_000_000),
  endsAt: instant(4_600_000),
  capacity: 8,
  status: 'scheduled',
  cancellation: null,
  policyRef: { serviceId: 'svc_1' as ServiceId, version: 2 },
  policySnapshot: policy,
  bookedCount: 0,
  attendedCount: 0,
  serviceName: 'Reformer',
  roomName: 'Salon A',
  trainerName: null,
  branchName: 'Merkez',
}

describe('scheduling event payloads match golden fixtures (AD-33)', () => {
  it('service.created', () => {
    expect(decideCreateService(ctx, service)[0]?.payload).toEqual(serviceCreated)
  })
  it('class_session.scheduled', () => {
    const r = decideScheduleSession(ctx, session, null)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value[0]?.payload).toEqual(sessionScheduled)
  })
  it('class_session.cancelled', () => {
    const r = decideCancelSession(ctx, session, 'Eğitmen hasta')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value[0]?.payload).toEqual(sessionCancelled)
  })
})
