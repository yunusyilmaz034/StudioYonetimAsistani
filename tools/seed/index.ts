// Seed staff auth users into the Firebase Auth EMULATOR with custom claims.
//
// Manual dev tool (like tools/migration): never deployed, never in CI. Run it with
// the Auth emulator up:
//
//   FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 pnpm seed
//
// It creates the Phase 1 staff for the demo studio so you can log in through the
// login screen against the emulator. No real project, no real secrets.
import { getApps, initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID ?? 'demo-sos'
const STUDIO_ID = 'std_demo'
const BRANCH_ID = 'brn_demo'
const PASSWORD = 'password'

interface SeedUser {
  readonly email: string
  readonly role: 'owner' | 'receptionist'
  readonly platformAdmin: boolean
}

const USERS: readonly SeedUser[] = [
  // The developer-owner is also the platform admin (Doc 1 §8).
  { email: 'owner@demo.test', role: 'owner', platformAdmin: true },
  { email: 'reception@demo.test', role: 'receptionist', platformAdmin: false },
]

async function main(): Promise<void> {
  if (!process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    throw new Error(
      'Refusing to run: FIREBASE_AUTH_EMULATOR_HOST is not set. This tool only seeds the emulator.',
    )
  }

  const app = getApps()[0] ?? initializeApp({ projectId: PROJECT_ID })
  const auth = getAuth(app)

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

    process.stdout.write(`seeded ${user.email} (${user.role}) -> ${record.uid}\n`)
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`${String(err)}\n`)
  process.exitCode = 1
})
