// `pnpm setup:trainers` — create the studio's trainers, mirroring the staff Server Action exactly:
// an Auth account, then the record + `staff.created` event in one transaction, then — last — the
// claims that make the account mean anything. That order is the design: a failure halfway leaves a
// trainer with a record and no access (visible, harmless, re-runnable), never access with no record.
//
// Idempotent: an account is reused if the e-mail already exists, and `createStaff` returns
// `created: false` rather than duplicating. A second run is a no-op.
//
// Passwords: a trainer does NOT log in during setup. Each account is created with a random password
// nobody ever sees; when the owner later sets the trainer's real e-mail, the trainer uses the login
// screen's "Şifremi unuttum" to choose their own. So no password is printed, stored, or messaged.
//
// The actor is `platform_admin`: this is a terminal setup act, not the owner clicking (#5).
import { randomBytes } from 'node:crypto'

import {
  createStaff,
  FirestoreIdentityRepository,
  systemClock,
  type StaffUserId,
  type StudioId,
  type TenantContext,
} from '@studio/core'
import { initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'

const PROJECT = process.env.GCLOUD_PROJECT ?? 'demo-sos'
if (!process.env.FIRESTORE_EMULATOR_HOST && !process.env.ALLOW_PRODUCTION) {
  console.error('Refusing to run against production without ALLOW_PRODUCTION=1.')
  process.exit(1)
}

const STUDIO = (process.argv[2] ?? 'retro') as StudioId
const BRANCH = process.argv[3] ?? 'mutlukent'

// The UI shows only "Hoca" — no surname, the owner's call for privacy. The e-mail is the login
// identity; the two placeholders are to be replaced from the panel when the real addresses are known,
// at which point the trainer sets her own password. Işıl-the-trainer is a SEPARATE account from
// Işıl-the-owner (different e-mail): the owner role is not assignable to a class, `trainer` is.
const TRAINERS = [
  { displayName: 'Işıl Hoca', email: 'isilsarikamis@gmail.com', placeholder: false },
  { displayName: 'Reyhan Hoca', email: 'reyhan.hoca@pilatesfitnessbyisil.com', placeholder: true },
  { displayName: 'Buse Hoca', email: 'buse.hoca@pilatesfitnessbyisil.com', placeholder: true },
]

async function main(): Promise<void> {
  initializeApp({ projectId: PROJECT })
  const db = getFirestore()
  const auth = getAuth()

  const ctx: TenantContext = {
    studioId: STUDIO,
    branchIds: [BRANCH as never],
    role: 'owner',
    actor: { type: 'platform_admin', id: 'setup' as never },
  }
  const deps = { repo: new FirestoreIdentityRepository(db), clock: systemClock }

  for (const t of TRAINERS) {
    // 1. The account, reused if it already exists (idempotent), created with an unknown password.
    const existing = await auth.getUserByEmail(t.email).catch(() => null)
    const user =
      existing ??
      (await auth.createUser({
        email: t.email,
        password: randomBytes(24).toString('base64url'),
        displayName: t.displayName,
      }))

    // 2. The record + event, in one transaction. `created: false` means it was already there.
    const res = await createStaff(deps, ctx, {
      staff: {
        id: user.uid as StaffUserId,
        displayName: t.displayName, // PII — lives on /staff, never in the event (#6)
        role: 'trainer',
        active: true,
      },
    })
    if (!res.ok) throw new Error(`${t.displayName} kaydedilemedi: ${res.error.code}`)

    // 3. Only now does the account become somebody — a trainer, scoped to this studio.
    await auth.setCustomUserClaims(user.uid, {
      studioId: STUDIO,
      role: 'trainer',
      branchIds: [BRANCH],
      platformAdmin: false,
    })

    const tag = t.placeholder ? ' (PLACEHOLDER e-posta — panelden değiştirilecek)' : ''
    console.log(`  ${res.value.created ? '+' : '✓'} ${t.displayName} · ${t.email}${tag}`)
  }

  console.log('\n✅ Eğitmenler kuruldu. Placeholder adresli olanlar panelden gerçek e-postayla güncellenmeli.')
  process.exit(0)
}

void main()
