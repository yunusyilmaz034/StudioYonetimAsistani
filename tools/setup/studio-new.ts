// `pnpm studio:new` — open a new studio, in one command, through the domain's own paths.
//
//   pnpm studio:new -- --studio=<sid> --branch=<bid> --name="Stüdyo Adı" \
//                      --owner-email=… --owner-name="Ad Soyad" [--branch-name="Merkez"] [--apply]
//
// ── What it creates, and why exactly these three ────────────────────────────────────────────
// A studio has no root document — `/studios/{sid}` is a path prefix, not a record. So "does this
// studio exist?" has no direct answer; what it has is three things without which the panel cannot
// open at all:
//
//   1. `settings/studio` — provisioning. THIS is where the number six lives (D14): the domain never
//      knows a cancellation window, it resolves session → service → studio and refuses if nobody
//      answers. A studio without this document cannot schedule anything.
//   2. The branch — required before any check-in can be recorded.
//   3. The owner — an Auth account, a `/staff` record with its event, and only then the claims.
//      Without it nobody can sign in, which is the state a fresh project starts in.
//
// ── What it deliberately does NOT create ────────────────────────────────────────────────────
// Products, services, trainers, exercises, the payment merchant, the WhatsApp identity. Every one
// of them is the STUDIO'S OWN content, and a provisioning script that invents a product name or a
// price is AD-41's violation wearing a different hat ("the catalogue is data"). Services are left
// out for the same reason plus one more: a service carries a category and a policy, and guessing
// either produces a studio that looks configured and behaves wrongly.
//
// So the script finishes by PRINTING what remains, in order, with the command for each. One command
// replaces the guesswork about what to run next, which is the actual cost being removed here — not
// the typing.
//
// ── Safety ──────────────────────────────────────────────────────────────────────────────────
// Dry-run by DEFAULT; `--apply` writes. And it REFUSES a studio that already has members: the
// failure this guards against is `pnpm studio:new --studio=retro`, typed by someone who meant a new
// id, against a studio 120 women depend on (OR-36). A half-provisioned new studio has no members,
// so the guard costs a legitimate re-run nothing.
//
// Idempotent throughout. `settings/studio` is written only when ABSENT — never corrected — because
// a re-run must not silently reset working hours the owner has since fixed in Ayarlar. The branch
// is merge-only, and `createStaff` reports `created: false` rather than duplicating.
//
// Manual, admin-only, never in CI. Actor is `platform_admin` (#5): a terminal is not a person, and
// the log must not borrow the owner's identity for a setup act she did not perform.
import { randomBytes } from 'node:crypto'

import {
  createStaff,
  DEFAULT_STUDIO_CONFIG,
  FirestoreCheckinRepository,
  FirestoreIdentityRepository,
  FirestoreSchedulingRepository,
  FirestoreStudioHours,
  openBranch,
  systemClock,
  updateStudioSettings,
  type BranchId,
  type StaffUserId,
  type StudioId,
  type StudioSettings,
  type TenantContext,
} from '@studio/core'
import { initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'

interface Args {
  readonly studioId: StudioId
  readonly branchId: BranchId
  readonly studioName: string
  readonly branchName: string
  readonly ownerEmail: string
  readonly ownerName: string
  readonly timeZone: string
  readonly apply: boolean
}

const USAGE = `Kullanım:
  pnpm studio:new -- --studio=<sid> --branch=<bid> --name="Stüdyo Adı" \\
                     --owner-email=<e-posta> --owner-name="Ad Soyad" \\
                     [--branch-name="Merkez"] [--timezone=Europe/Istanbul] [--apply]

  --apply olmadan hiçbir şey yazılmaz.`

function parseArgs(): Args {
  const argv = process.argv.slice(2)
  const flag = (n: string): string | undefined => argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3)

  const studioId = flag('studio')
  const branchId = flag('branch')
  const studioName = flag('name')
  const ownerEmail = flag('owner-email')
  const ownerName = flag('owner-name')

  if (!studioId || !branchId || !studioName || !ownerEmail || !ownerName) {
    console.error(USAGE)
    process.exit(2)
  }
  // A studio id becomes a path segment in every document this studio will ever own, and it is not
  // renameable afterwards — so it is checked here rather than discovered as a broken path later.
  if (!/^[a-z][a-z0-9_-]{1,30}$/.test(studioId)) {
    console.error(`Geçersiz stüdyo kimliği '${studioId}'. Küçük harfle başlamalı; harf, rakam, - ve _ kullanılabilir.`)
    process.exit(2)
  }
  if (!/^[a-z][a-z0-9_-]{1,30}$/.test(branchId)) {
    console.error(`Geçersiz şube kimliği '${branchId}'. Aynı kural geçerli.`)
    process.exit(2)
  }
  return {
    studioId: studioId as StudioId,
    branchId: branchId as BranchId,
    studioName,
    branchName: flag('branch-name') ?? 'Merkez',
    ownerEmail,
    ownerName,
    timeZone: flag('timezone') ?? 'Europe/Istanbul',
    apply: argv.includes('--apply'),
  }
}

/**
 * Sane opening values — every one of them editable from Ayarlar afterwards. They are defaults
 * rather than flags on purpose: a command with ten flags is a command nobody types correctly, and
 * these are precisely the values the owner wants to see on screen and adjust, not dictate blind
 * from a terminal on day one.
 */
function openingSettings(args: Args): StudioSettings {
  return {
    studioId: args.studioId,
    defaultCancellationWindowHours: 6,
    lowCreditThreshold: 2,
    discountCeilingPercent: 20,
    defaultSessionDurationMinutes: 50,
    timeZone: args.timeZone,
    company: {
      legalName: args.studioName,
      displayName: args.studioName,
      taxOffice: '',
      taxNumber: '',
      phone: '',
      email: args.ownerEmail,
      website: null,
      address: '',
      mapsUrl: null,
    },
    // Closed on Sunday, open the rest — the shape a Turkish boutique studio usually starts from.
    // Wrong hours are visible on the first day and fixed in a minute; absent hours refuse sessions.
    workingHours: {
      0: null,
      1: { open: '09:00', close: '21:00' },
      2: { open: '09:00', close: '21:00' },
      3: { open: '09:00', close: '21:00' },
      4: { open: '09:00', close: '21:00' },
      5: { open: '09:00', close: '21:00' },
      6: { open: '10:00', close: '17:00' },
    },
    qr: { tokenTtlSeconds: 60, checkInWindowMinutes: 30 },
    // Left unconfigured on purpose. Each has a documented fallback, and a value invented here would
    // be indistinguishable from one the owner chose.
    notifications: null,
    fitness: null,
    paymentSurcharge: null,
    showCancelledSessions: null,
    classReminder: null,
  }
}

/** The guard: a studio with members is a studio in use, and this script does not touch those. */
async function memberCount(db: Firestore, studioId: StudioId): Promise<number> {
  const snap = await db.collection('studios').doc(studioId).collection('members').limit(1).get()
  return snap.size
}

function nextSteps(args: Args): string {
  return [
    '',
    'Sırada — hepsi stüdyonun KENDİ içeriği, bu yüzden burada üretilmedi:',
    '',
    `  1. Servisler ve politikaları   panelden (Ayarlar › Servisler) — kategori sonradan değişmez`,
    `  2. Ürünler / fiyat listesi     panelden (Paketler) veya bir kerelik içe aktarımla`,
    `  3. Eğitmenler                  panelden (Personel)`,
    `  4. Çalışma saatleri ve şirket bilgileri   Ayarlar › Stüdyo (varsayılanlarla açıldı)`,
    `  5. PAYTR                       pnpm setup:payment-provider ${args.studioId} <mağaza-no> <panel-url>`,
    `  6. WhatsApp kimliği            müşterinin kendi WABA'sı — Meta süreci (Faz A1)`,
    `  7. E-posta göndericisi         müşterinin alan adında SPF/DKIM (Faz A2)`,
    '',
  ].join('\n')
}

async function main(): Promise<void> {
  const args = parseArgs()
  const project = process.env.FIREBASE_PROJECT_ID ?? process.env.GCLOUD_PROJECT
  if (!process.env.FIRESTORE_EMULATOR_HOST && !process.env.ALLOW_PRODUCTION) {
    console.error('Refusing to run against production without ALLOW_PRODUCTION=1.')
    process.exit(1)
  }

  console.log(`\nProje  : ${project ?? '(ADC varsayılanı)'}`)
  console.log(`Stüdyo : ${args.studioId} — ${args.studioName}`)
  console.log(`Şube   : ${args.branchId} — ${args.branchName}`)
  console.log(`Owner  : ${args.ownerName} <${args.ownerEmail}>`)
  console.log(`Saat d.: ${args.timeZone}\n`)

  // An ABSENT projectId and one that is `undefined` are different things to the Admin SDK, and the
  // second is how a script quietly talks to the wrong project.
  initializeApp(project ? { projectId: project } : {})
  const db = getFirestore()
  const auth = getAuth()

  // ── The guard, BEFORE anything is read or written. ────────────────────────────────────────
  if ((await memberCount(db, args.studioId)) > 0) {
    console.error(`❌ '${args.studioId}' stüdyosunun üyeleri var — bu bir kurulum değil, çalışan bir stüdyo.`)
    console.error('   Bu script çalışan bir stüdyoya dokunmaz. Yeni bir kimlik ver.\n')
    process.exit(1)
  }

  const schedRepo = new FirestoreSchedulingRepository()
  const existingSettings = await schedRepo.getStudioSettings({
    studioId: args.studioId,
    branchIds: [args.branchId],
    role: 'owner',
    actor: { type: 'platform_admin', id: 'studio_new' as never },
  } as TenantContext)
  const existingOwner = await auth.getUserByEmail(args.ownerEmail).catch(() => null)

  console.log('Durum:')
  console.log(`  settings/studio : ${existingSettings ? 'ZATEN VAR — dokunulmayacak' : 'yazılacak'}`)
  console.log(`  şube            : ${args.branchId} (merge — zaten varsa değişmez)`)
  console.log(`  owner hesabı    : ${existingOwner ? `zaten kayıtlı (${existingOwner.uid})` : 'oluşturulacak'}`)

  if (!args.apply) {
    console.log('\nDRY-RUN — hiçbir şey yazılmadı. Uygulamak için: --apply')
    console.log(nextSteps(args))
    return
  }

  const ctx: TenantContext = {
    studioId: args.studioId,
    branchIds: [args.branchId],
    // `platform_admin` is a capability, never a studio role (Doc 1 §8). What makes this an admin
    // act is the ACTOR, and the domain checks exactly that.
    role: 'owner',
    actor: { type: 'platform_admin', id: 'studio_new' as never },
  }

  // ── 1. Provisioning. Written ONLY when absent (see the header). ───────────────────────────
  if (!existingSettings) {
    const deps = {
      repo: schedRepo,
      clock: systemClock,
      studioConfig: DEFAULT_STUDIO_CONFIG,
      hours: new FirestoreStudioHours(db),
    }
    const res = await updateStudioSettings(deps, ctx, openingSettings(args))
    if (!res.ok) {
      console.error(`❌ settings/studio reddedildi: ${JSON.stringify(res.error)}`)
      process.exit(1)
    }
    console.log('\n✅ settings/studio yazıldı (varsayılanlarla).')
  } else {
    console.log('\n•  settings/studio zaten vardı — korundu.')
  }

  // ── 2. The branch. Merge-only, so a second run changes nothing. ───────────────────────────
  const branch = await openBranch({ repo: new FirestoreCheckinRepository(), clock: systemClock }, ctx, {
    branchId: args.branchId,
  })
  if (!branch.ok) {
    console.error(`❌ Şube açılamadı: ${JSON.stringify(branch.error)}`)
    process.exit(1)
  }
  console.log(`✅ Şube hazır: ${args.branchId}`)

  // ── 3. The owner. Account first WITHOUT claims, then record + event, then claims. ─────────
  // That order is the design: dying between the record and the claims leaves an account that can
  // sign in and reach nothing — visible, harmless, re-runnable. The reverse leaves full access
  // with no record of how it was granted.
  const tempPassword = randomBytes(9).toString('base64url')
  const user =
    existingOwner ??
    (await auth.createUser({ email: args.ownerEmail, password: tempPassword, displayName: args.ownerName }))

  const staff = await createStaff({ repo: new FirestoreIdentityRepository(db), clock: systemClock }, ctx, {
    staff: { id: user.uid as StaffUserId, displayName: args.ownerName, role: 'owner', active: true },
  })
  if (!staff.ok) {
    console.error(`❌ Owner kaydı reddedildi: ${JSON.stringify(staff.error)}`)
    process.exit(1)
  }

  await auth.setCustomUserClaims(user.uid, {
    studioId: args.studioId,
    role: 'owner',
    branchIds: [args.branchId],
    platformAdmin: false, // only the founding owner of the PLATFORM carries this, not every customer
  })
  console.log(`✅ Owner hazır: ${user.uid}${staff.value.created ? ' (staff.created yazıldı)' : ' (kayıt zaten vardı)'}`)

  if (!existingOwner) {
    console.log(`\n⚠️  Tek kullanımlık şifre: ${tempPassword}`)
    console.log('   BİR KEZ gösterilir, hiçbir yere kaydedilmez. Owner ilk girişte değiştirmeli.')
  }

  console.log(nextSteps(args))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
