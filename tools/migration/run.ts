import {
  FirestoreMemberRepository,
  registerMember,
  systemClock,
  type BranchId,
  type MembersDeps,
  type MigrationRunId,
  type StudioId,
  type TenantContext,
} from '@studio/core'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

import { isClean, validateMembers, type ValidMember } from './canonical'
import { readBulutGymMembers } from './csv'
import { renderValidationReport, writeReport } from './validate'

// THE IMPORT. Run by hand, with admin credentials, once (AD-36).
//
//   pnpm migrate:dry-run  -- <file.csv> --studio=<sid> --branch=<bid>     ← writes NOTHING
//   pnpm migrate:import   -- <file.csv> --studio=<sid> --branch=<bid> --apply
//
// ── What this imports, and what it refuses to invent ─────────────────────────────────────────
// BulutGym gives a name and a phone; that is all (owner, 2026-07-13). So that is all that is
// imported. **Packages, credits, balances and history are NOT derived, NOT estimated and NOT
// carried over** — they are opened by hand, member by member, against the owner's own list.
//
// This is a *smaller* migration than the architecture anticipated (AD-11: "the importer emits
// historical events, and the log therefore contains the studio's real history"). It is smaller
// because the source data is smaller. The consequence is stated plainly rather than papered over:
// **this studio's event log begins at go-live.** There is no imported history, because there is
// nothing truthful to import. The raw export is archived regardless — the day BulutGym's
// subscription lapses, whatever it held becomes unrecoverable forever.
//
// ── Actor ────────────────────────────────────────────────────────────────────────────────────
// Every event this writes carries `actor: {type:'migration', id:'import_…'}` and `source:
// 'migration'`. It never borrows a human's identity (#5), and it never claims reception typed
// these women in one by one. A year from now, "where did this member come from?" has an answer.

interface Args {
  readonly file: string
  readonly studioId: StudioId
  readonly branchId: BranchId | null
  readonly apply: boolean
}

function parseArgs(): Args {
  const argv = process.argv.slice(2)
  const file = argv.find((a) => !a.startsWith('--'))
  const flag = (name: string): string | undefined =>
    argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1]

  if (!file) {
    console.error(
      'Kullanım: pnpm migrate:dry-run -- <dosya.csv> --studio=<studioId> [--branch=<branchId>] [--apply]',
    )
    process.exit(2)
  }
  const studioId = flag('studio')
  if (!studioId) {
    console.error('--studio=<studioId> zorunlu. Hangi stüdyoya aktarıldığı tahmin edilmez.')
    process.exit(2)
  }

  return {
    file,
    studioId: studioId as StudioId,
    branchId: (flag('branch') ?? null) as BranchId | null,
    apply: argv.includes('--apply'),
  }
}

function newRunId(): MigrationRunId {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '')
  return `import_${stamp}` as MigrationRunId
}

function renderImportReport(
  runId: MigrationRunId,
  applied: boolean,
  imported: readonly ValidMember[],
  failed: readonly { member: ValidMember; code: string }[],
): string {
  const lines: string[] = []
  lines.push(`# İçe aktarma raporu — \`${runId}\``)
  lines.push('')
  lines.push(applied ? '**MOD: APPLY — veriler yazıldı.**' : '**MOD: DRY-RUN — hiçbir şey yazılmadı.**')
  lines.push('')
  lines.push(`İçe aktarılan üye: **${imported.length}**`)
  lines.push(`Başarısız: **${failed.length}**`)
  lines.push('')
  lines.push('İçe aktarılanlar: yalnızca **ad soyad + telefon**.')
  lines.push('Paket, kredi, bakiye ve geçmiş **aktarılmadı** — tahmin edilmedi, elle açılacak.')
  lines.push('')

  if (failed.length) {
    lines.push('## Başarısız satırlar')
    lines.push('')
    lines.push('| Satır | Ad Soyad | Telefon | Hata |')
    lines.push('|---|---|---|---|')
    for (const f of failed) {
      lines.push(`| ${f.member.line} | ${f.member.fullName} | ${f.member.phoneE164} | ${f.code} |`)
    }
    lines.push('')
    lines.push(
      '> `member_phone_taken` genellikle **bu import’un ikinci kez çalıştırıldığı** anlamına gelir: ' +
        'telefon benzersizdir (I-21) ve domain aynı üyeyi ikinci kez kaydetmeyi reddeder. Bu bir ' +
        'hata değil, bir korumadır.',
    )
  }

  return `${lines.join('\n')}\n`
}

async function main(): Promise<void> {
  const args = parseArgs()

  // ── 1. VALIDATE. A single bad row blocks the entire run. ──────────────────────────────────
  const rows = readBulutGymMembers(args.file)
  const validation = validateMembers(rows)
  writeReport('validation.md', renderValidationReport(validation))

  console.log(
    `Doğrulama: ${validation.total} satır · geçerli ${validation.valid.length} · reddedilen ${validation.rejected.length}`,
  )
  if (!isClean(validation)) {
    console.error(
      '\n❌ İçe aktarma REDDEDİLDİ. Reddedilen satırlar var (tools/migration/reports/validation.md).',
    )
    console.error('   Kaynak dosya düzeltilmeli. Hiçbir satır tahmin edilmez, hiçbir satır atlanmaz.')
    process.exit(1)
  }

  if (!args.apply) {
    // The dry run stops HERE, having proved the file is importable without touching anything. That
    // is the whole value: the rehearsal is worthless if it can also break something.
    writeReport('import.md', renderImportReport(newRunId(), false, validation.valid, []))
    console.log(`\n✅ DRY-RUN temiz. ${validation.valid.length} üye içe aktarılabilir.`)
    console.log('   Yazmak için: --apply')
    return
  }

  // ── 2. IMPORT. ────────────────────────────────────────────────────────────────────────────
  const runId = newRunId()
  initializeApp(
  // `exactOptionalPropertyTypes`: an ABSENT projectId and a projectId that is `undefined` are not the
  // same thing to the Admin SDK, and the second one is how a script silently talks to the wrong
  // project.
  process.env.FIREBASE_PROJECT_ID ? { projectId: process.env.FIREBASE_PROJECT_ID } : {},
)
  const db = getFirestore()

  const ctx: TenantContext = {
    studioId: args.studioId,
    branchIds: args.branchId ? [args.branchId] : [],
    role: 'owner',
    actor: { type: 'migration', id: runId }, // never a borrowed human identity (#5)
  }
  const deps: MembersDeps = {
    repo: new FirestoreMemberRepository(db),
    clock: systemClock,
    source: 'migration', // the log will say what produced these rows, and it will be true
  }

  const imported: ValidMember[] = []
  const failed: { member: ValidMember; code: string }[] = []

  for (const member of validation.valid) {
    const res = await registerMember(deps, ctx, {
      fullName: member.fullName,
      phone: member.phoneE164,
      homeBranchId: args.branchId,
      // Everything else is ABSENT, and absence is the honest record of what the source held. A
      // birth date we invent is a birthday card sent on the wrong day, forever.
      email: null,
      birthDate: null,
      notes: null,
      emergencyContact: null,
    })
    if (res.ok) imported.push(member)
    else failed.push({ member, code: res.error.code })
  }

  const path = writeReport('import.md', renderImportReport(runId, true, imported, failed))
  console.log(`\nİçe aktarıldı: ${imported.length} · başarısız: ${failed.length}`)
  console.log(`Rapor: ${path}`)
  if (failed.length) process.exit(1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
