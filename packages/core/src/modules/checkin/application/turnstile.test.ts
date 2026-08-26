import { describe, expect, it } from 'vitest'

import { instant, type BranchId, type DeviceId, type MemberId, type StudioId, type TenantContext } from '../../../shared'
import type { CheckIn, Presence, TurnstileCode, TurnstileDevice } from '../domain/types'
import type { CheckinDeps } from './ports'
import { crossTurnstile } from './turnstile'

// WHY THIS FILE EXISTS.
//
// `decideCheckIn` refuses a second crossing within 45 s — unless a direction was STATED, because
// reception pressing "Çıkış" is a deliberate act and refusing it would leave a member stuck inside.
// The turnstile passed a direction on every crossing, so it took that exemption every time and the
// guard never once ran on the path it was written for.
//
// The screen issues a new code every few seconds. A member who left the camera open entered and
// immediately left again, and occupancy drifted somewhere nobody was looking. The owner found it in
// ten minutes of real use; 1094 tests had not, because every one of them stopped at a layer
// boundary — the domain was tested with a direction, and nobody asked what the turnstile sends.

const NOW = 1_800_000_000_000
const STUDIO = 'retro' as StudioId
const BRANCH = 'brn_1' as BranchId
const MEMBER = 'mem_1' as MemberId
const DEVICE = 'dev_1' as DeviceId
const CODE = '123456'

const CTX = { studioId: STUDIO, branchIds: [BRANCH], role: 'kiosk', actor: { type: 'device', id: DEVICE } } as unknown as TenantContext

const device: TurnstileDevice = {
  id: DEVICE,
  studioId: STUDIO,
  branchId: BRANCH,
  name: 'Giriş turnikesi',
  secretHash: 'x',
  active: true,
  lastSeenAt: null,
  createdAt: instant(NOW - 86_400_000),
}

const code: TurnstileCode = {
  code: CODE,
  deviceId: DEVICE,
  studioId: STUDIO,
  branchId: BRANCH,
  issuedAt: instant(NOW - 2_000),
  expiresAt: instant(NOW + 20_000),
  usedBy: null,
  usedAt: null,
}

/** Only what `crossTurnstile` touches. A fuller fake would hide which parts decide anything. */
function fakeDeps(opts: { presence: Presence | null; lastCrossedAt?: number }): CheckinDeps {
  const recent: CheckIn[] =
    opts.lastCrossedAt === undefined
      ? []
      : ([{ occurredAt: instant(opts.lastCrossedAt) }] as unknown as CheckIn[])

  return {
    clock: { now: () => instant(NOW) },
    repo: {
      getTurnstileCode: async () => code,
      getDevice: async () => device,
      getPresence: async () => opts.presence,
      consumeTurnstileCode: async () => true,
      getBranch: async () => ({ branchId: BRANCH, isOpen: true, capacity: 50 }),
      countPresence: async () => 3,
      listCheckInsByMember: async () => recent,
      applyCheckIn: async () => undefined,
      touchDevice: async () => undefined,
    },
  } as unknown as CheckinDeps
}

const inside: Presence = { memberId: MEMBER, branchId: BRANCH, checkedInAt: instant(NOW - 15_000) }

describe('crossTurnstile — the double-scan guard actually runs', () => {
  it('refuses a second crossing seconds after the first', async () => {
    // The exact case the owner hit: scan, then the screen rotates and the still-open camera fires
    // again. Under the old code this recorded an exit fifteen seconds after the entry.
    const r = await crossTurnstile(fakeDeps({ presence: inside, lastCrossedAt: NOW - 15_000 }), CTX, {
      memberId: MEMBER,
      code: CODE,
      reportedDirection: null,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('checkin_too_soon')
  })

  it('lets her out once the window has passed', async () => {
    const r = await crossTurnstile(fakeDeps({ presence: inside, lastCrossedAt: NOW - 60_000 }), CTX, {
      memberId: MEMBER,
      code: CODE,
      reportedDirection: null,
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.direction).toBe('out')
  })

  it('a first crossing is never debounced — there is nothing to repeat', async () => {
    const r = await crossTurnstile(fakeDeps({ presence: null }), CTX, {
      memberId: MEMBER,
      code: CODE,
      reportedDirection: null,
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.direction).toBe('in')
  })

  it('an ARM-REPORTED direction still bypasses the guard, and should', async () => {
    // The exemption is not a bug — it exists for a direction that was genuinely asserted rather
    // than inferred. When the arm's direction wire is wired up it says what the door DID, and what
    // the door did is not a double press.
    const r = await crossTurnstile(fakeDeps({ presence: inside, lastCrossedAt: NOW - 5_000 }), CTX, {
      memberId: MEMBER,
      code: CODE,
      reportedDirection: 'out',
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.direction).toBe('out')
  })
})
