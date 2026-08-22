import { describe, expect, it } from 'vitest'

import {
  DEFAULT_STUDIO_CONFIG,
  instant,
  type BranchId,
  type NewEvent,
  type ServiceId,
  type StudioId,
  type TenantContext,
} from '../../../shared'
import type { ClassSession, Service, SchedulingPolicy } from '../domain/types'
import type { SchedulingDeps } from './ports'
import { scheduleSession, type ScheduleSessionInput } from './session'

// WHY THIS FILE EXISTS.
//
// `buildSession` took `admission` and `contentLabel` as parameters and never put them in the object
// it returned. Everything type-checked, 1069 tests passed, and the Fit Paket feature was dead in
// production for two days: the event recorded `defaultAdmission()`, the session document carried
// nothing, and the class was invisible to every member it was built for.
//
// Nothing caught it because every test stopped at a layer boundary — the decider was tested with a
// session that ALREADY had admission, and the action was tested for what it passed on. Nobody
// asked the one question that mattered: give the use case an admission, does the SAVED session have
// it? That is what this file asks.

const STUDIO = 'std_1' as StudioId
const SVC = 'svc_fit' as ServiceId

const POLICY: SchedulingPolicy = {
  maxDaysInAdvance: 30,
  cancellationWindowHours: 6,
  lateCancellationConsumesCredit: true,
  noShowConsumesCredit: true,
  attendanceDefaultOutcome: 'attended',
  autoResolveAfterMinutes: 180,
  allowMemberSelfBooking: true,
}

const SERVICE: Service = {
  id: SVC,
  studioId: STUDIO,
  name: 'Fit Paket',
  category: 'pilates_group',
  policy: POLICY,
  policyVersion: 1,
  active: true,
}

const CTX = { studioId: STUDIO, actor: { kind: 'staff', id: 'stf_1' } } as unknown as TenantContext

/** Only what `scheduleSession` actually touches. A fuller fake would hide which parts matter. */
function fakeDeps(): { deps: SchedulingDeps; saved: { session?: ClassSession; events: NewEvent[] } } {
  const saved: { session?: ClassSession; events: NewEvent[] } = { events: [] }
  const deps = {
    repo: {
      getService: async () => SERVICE,
      getRoom: async () => null,
      getStudioSettings: async () => null,
      saveSession: async (_c: TenantContext, session: ClassSession, events: readonly NewEvent[]) => {
        saved.session = session
        saved.events = [...events]
      },
    },
    // `hours: null` = "the studio has not said when it is open", which is not "closed".
    hours: { getStudioHours: async () => ({ hours: null, utcOffsetMinutes: 180, specialWorkingDates: new Set() }) },
    clock: { now: () => instant(1_780_000_000_000) },
    studioConfig: DEFAULT_STUDIO_CONFIG,
  } as unknown as SchedulingDeps
  return { deps, saved }
}

const input = (o: Partial<ScheduleSessionInput> = {}): ScheduleSessionInput => ({
  serviceId: SVC,
  branchId: 'brn_1' as BranchId,
  branchName: 'Merkez',
  roomId: null,
  trainerId: null,
  trainerName: null,
  date: '2026-08-26',
  startTime: '18:30',
  durationMinutes: 45,
  capacity: 8,
  ...o,
})

const FIT = { categories: ['pilates_group', 'fitness'], weeklyQuotaByCategory: { fitness: 1 } } as const

describe('scheduleSession — what reaches the SAVED session', () => {
  it('carries the admission through to the stored session, not just the event', async () => {
    // The state document is what `decideBooking` and the member agenda read. An admission that
    // lives only in the event is an admission nobody enforces and nobody sees.
    const { deps, saved } = fakeDeps()
    const r = await scheduleSession(deps, CTX, input({ admission: FIT }))
    expect(r.ok).toBe(true)
    expect(saved.session?.admission).toEqual(FIT)
  })

  it('carries the content label through', async () => {
    const { deps, saved } = fakeDeps()
    await scheduleSession(deps, CTX, input({ contentLabel: 'HIIT Step' }))
    expect(saved.session?.contentLabel).toBe('HIIT Step')
  })

  it('trims the content label, and an all-space label is no label', async () => {
    const { deps, saved } = fakeDeps()
    await scheduleSession(deps, CTX, input({ contentLabel: '  HIIT Step  ' }))
    expect(saved.session?.contentLabel).toBe('HIIT Step')

    const blank = fakeDeps()
    await scheduleSession(blank.deps, CTX, input({ contentLabel: '   ' }))
    expect(blank.saved.session?.contentLabel).toBeUndefined()
  })

  it('an ordinary session stores NO admission — the default stays absent, not invented', async () => {
    // The regression that matters: every class the studio already runs must be written exactly as
    // before. `undefined` here is what makes "this session declares nothing" a real state.
    const { deps, saved } = fakeDeps()
    await scheduleSession(deps, CTX, input())
    expect(saved.session?.admission).toBeUndefined()
    expect(saved.session?.contentLabel).toBeUndefined()
  })

  it('the event still records the resolved default, so history is never ambiguous', async () => {
    const { deps, saved } = fakeDeps()
    await scheduleSession(deps, CTX, input())
    const payload = saved.events[0]?.payload as { admission?: { categories: string[] } }
    expect(payload.admission).toEqual({ categories: ['pilates_group'] })
  })
})
