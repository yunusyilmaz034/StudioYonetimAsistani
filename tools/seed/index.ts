// Seed the demo studio's staff into the Firebase EMULATORS: Auth users with custom
// claims (so you can log in), and their `/staff` Firestore documents (so the
// scheduling pickers can name a trainer — v1.12).
//
// Manual dev tool (like tools/migration): never deployed, never in CI. Run it with
// the Auth + Firestore emulators up:
//
//   FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 pnpm seed
//
// No real project, no real secrets. Staff creation as a first-class, event-emitting
// flow is a later milestone; here we only place the documents the demo needs.
import { getApps, initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID ?? 'demo-sos'
const STUDIO_ID = 'std_demo'
const BRANCH_ID = 'brn_demo'
const PASSWORD = 'password'

interface SeedUser {
  readonly email: string
  readonly displayName: string
  readonly role: 'owner' | 'receptionist' | 'trainer'
  readonly platformAdmin: boolean
}

const USERS: readonly SeedUser[] = [
  // The developer-owner is also the platform admin (Doc 1 §8).
  { email: 'owner@demo.test', displayName: 'Ayla Demir', role: 'owner', platformAdmin: true },
  { email: 'reception@demo.test', displayName: 'Deniz Kaya', role: 'receptionist', platformAdmin: false },
  { email: 'trainer@demo.test', displayName: 'Reyhan Yıldız', role: 'trainer', platformAdmin: false },
]

async function main(): Promise<void> {
  if (!process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    throw new Error(
      'Refusing to run: FIREBASE_AUTH_EMULATOR_HOST is not set. This tool only seeds the emulator.',
    )
  }

  const app = getApps()[0] ?? initializeApp({ projectId: PROJECT_ID })
  const auth = getAuth(app)
  const db = process.env.FIRESTORE_EMULATOR_HOST ? getFirestore(app) : null

  for (const user of USERS) {
    const record = await auth
      .getUserByEmail(user.email)
      .catch(() => auth.createUser({ email: user.email, password: PASSWORD }))

    await auth.setCustomUserClaims(record.uid, {
      studioId: STUDIO_ID,
      role: user.role,
      branchIds: [BRANCH_ID],
      platformAdmin: user.platformAdmin,
    })

    if (db) {
      await db
        .collection('studios')
        .doc(STUDIO_ID)
        .collection('staff')
        .doc(record.uid)
        .set({ displayName: user.displayName, role: user.role, branchIds: [BRANCH_ID], active: true })
    }

    process.stdout.write(
      `seeded ${user.email} (${user.role})${db ? ' + /staff' : ''} -> ${record.uid}\n`,
    )
  }

  if (!db) {
    process.stdout.write('note: FIRESTORE_EMULATOR_HOST unset — /staff documents not written.\n')
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`${String(err)}\n`)
  process.exitCode = 1
})
