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

// BOOTSTRAP — the first owner. Run by hand, once per studio, with admin credentials.
//
//   pnpm bootstrap:owner -- --studio=<sid> --branch=<bid> --email=… --name="…"
//   pnpm bootstrap:owner -- ... --apply
//
// ── Why this exists ─────────────────────────────────────────────────────────────────────────
// Until v1.27 staff accounts came ONLY from the emulator seed, which refuses to run against a real
// project. So on a fresh production project **nobody could log in at all** — there was no first user
// and no way to make one. The product could not be handed to the studio it was built for.
//
// ── Why it is a script and not a screen (owner, 2026-07-13) ─────────────────────────────────
// A "create the first owner" page that is reachable before anyone has signed in is a page that
// creates an owner for whoever finds it. There is no way to guard it that does not amount to a
// secret — and a secret in a URL is a secret in a browser history, a proxy log and a bookmark bar.
// A script run once, by a human, with admin credentials, on a machine that already has them, is the
// smaller surface. **After this, every staff account is created from the product**, by the owner.
//
// ── The order of the three writes, and why it is that order ─────────────────────────────────
//   1. Auth account, WITHOUT claims. It can sign in and it can reach nothing: with no `studioId`
//      claim, `parseStaffClaims` returns null and every guard treats her as a stranger.
//   2. The `/staff` document AND `staff.created`, in ONE transaction (#1).
//   3. Custom claims. Only now does the account become an owner.
//
// If it dies between 2 and 3, she has a record and no access — visible, harmless, and fixed by
// re-running: every step is idempotent. If the claims were set FIRST and the transaction failed,
// she would have full access with no record of how she got it, and that is the failure this order
// exists to make impossible.

interface Args {
  readonly studioId: StudioId
  readonly branchId: string
  readonly email: string
  readonly name: string
  readonly apply: boolean
}

function parseArgs(): Args {
  const argv = process.argv.slice(2)
  const flag = (n: string) => argv.find((a) => a.startsWith(`--${n}=`))?.split('=')[1]

  const studioId = flag('studio')
  const branchId = flag('branch')
  const email = flag('email')
  const name = flag('name')

  if (!studioId || !branchId || !email || !name) {
    console.error(
      'Kullanım: pnpm bootstrap:owner -- --studio=<sid> --branch=<bid> --email=<e-posta> --name="Ad Soyad" [--apply]',
    )
    process.exit(2)
  }
  return { studioId: studioId as StudioId, branchId, email, name, apply: argv.includes('--apply') }
}

async function main(): Promise<void> {
  const args = parseArgs()
  const project = process.env.FIREBASE_PROJECT_ID

  console.log(`\nProje  : ${project ?? '(ADC varsayılanı)'}`)
  console.log(`Stüdyo : ${args.studioId} · şube ${args.branchId}`)
  console.log(`Owner  : ${args.name} <${args.email}>\n`)

  initializeApp({ projectId: project })
  const auth = getAuth()
  const db = getFirestore()

  const existing = await auth.getUserByEmail(args.email).catch(() => null)
  if (existing) {
    const claims = (existing.customClaims ?? {}) as { studioId?: string; role?: string }
    console.log(`Bu e-posta zaten kayıtlı (uid: ${existing.uid}).`)
    console.log(`  mevcut claim: studioId=${claims.studioId ?? '—'} role=${claims.role ?? '—'}`)
    console.log('  Script idempotenttir: eksik adımları tamamlar, ikinci bir owner yaratmaz.\n')
  }

  if (!args.apply) {
    console.log('DRY-RUN — hiçbir şey yazılmadı. Uygulamak için: --apply\n')
    return
  }

  // ── 1. The Auth account, with NO claims yet. ──────────────────────────────────────────────
  // A one-time password, printed once, never stored. She changes it at first sign-in; a password we
  // chose and kept is a password we are responsible for.
  const tempPassword = randomBytes(9).toString('base64url')
  const user =
    existing ??
    (await auth.createUser({
      email: args.email,
      password: tempPassword,
      displayName: args.name,
    }))

  // ── 2. The record and its event, in ONE transaction. ──────────────────────────────────────
  // The actor is `platform_admin`: this is a break-glass act, performed from a terminal, and it is
  // the only staff record in the studio's history that no owner authorised — because there was no
  // owner yet. The log says so, permanently, and that is exactly what we want it to say.
  const ctx: TenantContext = {
    studioId: args.studioId,
    branchIds: [args.branchId as never],
    role: 'platform_admin',
    actor: { type: 'platform_admin', id: 'bootstrap' as never },
  }

  const res = await createStaff(
    { repo: new FirestoreIdentityRepository(db), clock: systemClock },
    ctx,
    {
      staff: {
        id: user.uid as StaffUserId,
        displayName: args.name,
        role: 'owner',
        active: true,
      },
    },
  )
  if (!res.ok) {
    console.error(`❌ Domain reddetti: ${res.error.code}`)
    process.exit(1)
  }

  // ── 3. The claims. ONLY NOW is the account an owner. ──────────────────────────────────────
  await auth.setCustomUserClaims(user.uid, {
    studioId: args.studioId,
    role: 'owner',
    branchIds: [args.branchId],
    platformAdmin: true, // the founding owner is also the platform admin (Doc 1 §8)
  })

  console.log('✅ Owner hazır.')
  console.log(`   uid   : ${user.uid}`)
  if (!existing) {
    console.log(`   şifre : ${tempPassword}`)
    console.log('\n⚠️  Bu şifre BİR KEZ gösterilir ve hiçbir yere kaydedilmez.')
    console.log('   Owner ilk girişte değiştirmeli.')
  }
  console.log(`   event : ${res.value.created ? 'staff.created yazıldı' : 'zaten vardı, yeni event yok'}`)
  console.log('\nBundan sonraki tüm personel, ürünün içinden — /staff ekranından — eklenir.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
