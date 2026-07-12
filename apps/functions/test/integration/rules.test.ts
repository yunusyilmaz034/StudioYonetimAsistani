import { readFileSync } from 'node:fs'

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import { doc, getDoc, setDoc, type Firestore } from 'firebase/firestore'
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest'

// Emulator integration tests for the tenant perimeter (firestore/firestore.rules,
// Doc 3 §8). Run via `pnpm test:integration` (firebase emulators:exec) — they need
// the Firestore emulator (a JVM), so they are NOT part of `pnpm check`.

let testEnv: RulesTestEnvironment

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-sos',
    firestore: { rules: readFileSync('firestore/firestore.rules', 'utf8') },
  })
})

afterAll(async () => {
  await testEnv.cleanup()
})

beforeEach(async () => {
  await testEnv.clearFirestore()
})

function db(
  uid: string,
  claims: {
    studioId: string
    role: string
    branchIds?: string[]
    platformAdmin?: boolean
    memberId?: string
  },
): Firestore {
  return testEnv.authenticatedContext(uid, claims).firestore() as unknown as Firestore
}

const ownerA = () => db('usr_owner_a', { studioId: 'std_A', role: 'owner', branchIds: ['brn_A'] })
const receptionA = () =>
  db('usr_rec_a', { studioId: 'std_A', role: 'receptionist', branchIds: ['brn_A'] })
const receptionB = () =>
  db('usr_rec_b', { studioId: 'std_B', role: 'receptionist', branchIds: ['brn_B'] })

// D11 (v1.21) — a MEMBER principal: a real, correctly-issued token for her own studio.
// Everything she attempts below must fail. Not because the UI hides it — because the
// perimeter has no rule that admits her.
const memberA = () =>
  db('uid_member_a', { studioId: 'std_A', role: 'member', memberId: 'mem_a' })

describe('tenant isolation', () => {
  it('lets a studio member read its own studio', async () => {
    await assertSucceeds(getDoc(doc(receptionA(), 'studios/std_A/members/m1')))
  })

  it('refuses reading another studio', async () => {
    await assertFails(getDoc(doc(receptionA(), 'studios/std_B/members/m1')))
    await assertFails(getDoc(doc(receptionB(), 'studios/std_A/members/m1')))
  })
})

describe('write perimeter (AD-15)', () => {
  it('refuses every client state write outside /commands', async () => {
    await assertFails(setDoc(doc(receptionA(), 'studios/std_A/members/m1'), { name: 'x' }))
    await assertFails(setDoc(doc(ownerA(), 'studios/std_A/products/p1'), { name: 'x' }))
    await assertFails(setDoc(doc(ownerA(), 'studios/std_A/events/e1'), { type: 'x' }))
  })
})

describe('events are owner-only, read never widened by the wildcard', () => {
  it('lets the owner read events but refuses reception', async () => {
    await assertSucceeds(getDoc(doc(ownerA(), 'studios/std_A/events/e1')))
    await assertFails(getDoc(doc(receptionA(), 'studios/std_A/events/e1')))
  })
})

describe('/commands — the one allowed client write', () => {
  const valid = {
    id: 'cmd_1',
    actor: { id: 'usr_rec_a' },
    type: 'checkIn.record',
    status: 'pending',
  }

  it('allows a whitelisted command created as oneself', async () => {
    await assertSucceeds(setDoc(doc(receptionA(), 'studios/std_A/commands/cmd_1'), valid))
  })

  it('refuses a command with someone else’s actor.id', async () => {
    await assertFails(
      setDoc(doc(receptionA(), 'studios/std_A/commands/cmd_1'), {
        ...valid,
        actor: { id: 'usr_someone_else' },
      }),
    )
  })

  it('refuses a non-whitelisted command type', async () => {
    await assertFails(
      setDoc(doc(receptionA(), 'studios/std_A/commands/cmd_1'), {
        ...valid,
        type: 'reservation.book',
      }),
    )
  })

  it('refuses a command in another studio', async () => {
    await assertFails(setDoc(doc(receptionA(), 'studios/std_B/commands/cmd_1'), valid))
  })
})

// ── D11 — the member security boundary ────────────────────────────────────────────────────
//
// Before v1.21 every authenticated principal was staff, so `allow read: if tenant()` was safe.
// The moment a member holds a studioId claim, that rule would hand her the entire studio.
// These tests are the proof that it does not.
describe('member principal: NO client-SDK read access (D11)', () => {
  it('cannot read /members — the whole PII register stays closed', async () => {
    await assertFails(getDoc(doc(memberA(), 'studios/std_A/members/m1')))
  })

  it('cannot read HER OWN member document either — the portal is server-rendered', async () => {
    // Even self-scoped reads are refused. Nothing is "almost open": every byte she sees comes
    // through a Server Action that derived her identity from the session cookie.
    await assertFails(getDoc(doc(memberA(), 'studios/std_A/members/mem_a')))
  })

  it('cannot read entitlements, payments, reservations, sessions, products or check-ins', async () => {
    const m = memberA()
    await assertFails(getDoc(doc(m, 'studios/std_A/entitlements/e1')))
    await assertFails(getDoc(doc(m, 'studios/std_A/payments/p1')))
    await assertFails(getDoc(doc(m, 'studios/std_A/reservations/r1')))
    await assertFails(getDoc(doc(m, 'studios/std_A/classSessions/cs1')))
    await assertFails(getDoc(doc(m, 'studios/std_A/products/prd1')))
    await assertFails(getDoc(doc(m, 'studios/std_A/checkIns/ci1')))
    await assertFails(getDoc(doc(m, 'studios/std_A/staff/usr_rec_a')))
    await assertFails(getDoc(doc(m, 'studios/std_A/settings/studio')))
  })

  it('cannot read the event log', async () => {
    await assertFails(getDoc(doc(memberA(), 'studios/std_A/events/e1')))
  })

  it('cannot read ANOTHER studio either — the tenant wall still stands beneath the role wall', async () => {
    await assertFails(getDoc(doc(memberA(), 'studios/std_B/members/m1')))
  })

  it('cannot write a command — not even a whitelisted one, not even as herself', async () => {
    // Two independent reasons, either of which suffices: she is not staff, and her Firebase uid
    // is not her memberId (so `actor.id == request.auth.uid` cannot hold for a member actor).
    await assertFails(
      setDoc(doc(memberA(), 'studios/std_A/commands/cmd_m1'), {
        id: 'cmd_m1',
        actor: { id: 'uid_member_a' },
        type: 'checkIn.record',
        status: 'pending',
      }),
    )
  })

  it('cannot write state anywhere', async () => {
    await assertFails(setDoc(doc(memberA(), 'studios/std_A/reservations/r1'), { memberId: 'mem_a' }))
    await assertFails(setDoc(doc(memberA(), 'studios/std_A/members/mem_a'), { fullName: 'x' }))
  })
})

describe('a forged/degenerate token buys nothing', () => {
  it('a token with NO role reads nothing, even with a correct studioId', async () => {
    const noRole = db('uid_x', { studioId: 'std_A', role: '' })
    await assertFails(getDoc(doc(noRole, 'studios/std_A/members/m1')))
  })

  it('an invented role reads nothing — the staff list is a closed set', async () => {
    const fake = db('uid_y', { studioId: 'std_A', role: 'admin' })
    await assertFails(getDoc(doc(fake, 'studios/std_A/members/m1')))
  })

  it('an unauthenticated client reads nothing', async () => {
    const anon = testEnv.unauthenticatedContext().firestore() as unknown as Firestore
    await assertFails(getDoc(doc(anon, 'studios/std_A/members/m1')))
  })
})

describe('staff reads still work (the boundary did not break the product)', () => {
  it('reception still reads members, sessions and settings', async () => {
    const r = receptionA()
    await assertSucceeds(getDoc(doc(r, 'studios/std_A/members/m1')))
    await assertSucceeds(getDoc(doc(r, 'studios/std_A/classSessions/cs1')))
    await assertSucceeds(getDoc(doc(r, 'studios/std_A/settings/studio')))
  })

  it('the trainer role reads too', async () => {
    const t = db('usr_trn_a', { studioId: 'std_A', role: 'trainer', branchIds: ['brn_A'] })
    await assertSucceeds(getDoc(doc(t, 'studios/std_A/classSessions/cs1')))
  })
})
