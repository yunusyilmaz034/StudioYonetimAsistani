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
  claims: { studioId: string; role: string; branchIds: string[]; platformAdmin?: boolean },
): Firestore {
  return testEnv.authenticatedContext(uid, claims).firestore() as unknown as Firestore
}

const ownerA = () => db('usr_owner_a', { studioId: 'std_A', role: 'owner', branchIds: ['brn_A'] })
const receptionA = () =>
  db('usr_rec_a', { studioId: 'std_A', role: 'receptionist', branchIds: ['brn_A'] })
const receptionB = () =>
  db('usr_rec_b', { studioId: 'std_B', role: 'receptionist', branchIds: ['brn_B'] })

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
