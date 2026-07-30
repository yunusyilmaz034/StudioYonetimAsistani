// BREAK-GLASS — assign one program template to every fitness member who has none.
//
//   pnpm tsx tools/migration/assign-program-template.ts <studioId> <templateId>           ← dry run
//   pnpm tsx tools/migration/assign-program-template.ts <studioId> <templateId> --apply
//
// ── Why ─────────────────────────────────────────────────────────────────────────────────────
//
// Sixty-one fitness memberships arrived from the old system in one import and none of them has a
// programme. "Her ay ölçüm, sana özel program" is one of the things this studio sells, and a member
// who opens the app to an empty training tab has been sold something she cannot see.
//
// Owner: *"çoğunluğu öyle, sen hepsine Program A'yı ata, Işıl farklı olanı gider elle değiştirir."*
// A shared baseline everyone can start from, personalised afterwards — which is how a gym actually
// works, and is very different from pretending the baseline is personal.
//
// ── What it will NOT do ─────────────────────────────────────────────────────────────────────
//
// Touch a member who already has a programme. Two do, and overwriting somebody's real programme with
// a template is not a bulk operation anyone can undo from memory.
//
// ── The part that reaches actual people ─────────────────────────────────────────────────────
//
// `instantiateTemplate` publishes the programme's first version, which emits
// `program.version_published`, which notifies the member. Sixty-one messages.
//
// They are `normal` priority, so quiet hours (22:00–08:00) HOLD them: run this at night and nothing
// leaves until 08:00. That is deliberate breathing room, not a trick — the owner sees the count in
// the morning with hours to spare, and a queued intent can still be cancelled.
import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

import {
  FirestoreTrainingRepository,
  instantiateTemplate,
  systemClock,
  type MigrationRunId,
  type StudioId,
  type TenantContext,
} from '@studio/core'

const studioId = (process.argv[2] ?? '') as StudioId
const templateId = process.argv[3] ?? ''
const apply = process.argv.includes('--apply')
if (!studioId || !templateId) {
  console.error('kullanım: assign-program-template.ts <studioId> <templateId> [--apply]')
  process.exit(1)
}

initializeApp({ projectId: process.env.GCLOUD_PROJECT ?? 'demo-sos' })
const db = getFirestore()

const ctx: TenantContext = {
  studioId,
  branchIds: [],
  role: 'owner',
  // A script is an actor in its own right and never borrows a human's identity (#5).
  actor: { type: 'migration', id: 'mig_assign_program_a_20260731' as MigrationRunId },
}

async function main(): Promise<void> {
  const now = Date.now()

  // Members holding a LIVE fitness package. `status === 'active'` is not enough on its own — a
  // package can be active and already past its end date until the nightly sweep gets to it.
  const ents = await db.collection(`studios/${studioId}/entitlements`).where('status', '==', 'active').get()
  const fitness = new Set<string>()
  for (const doc of ents.docs) {
    const x = doc.data()
    if (x.productSnapshot?.category !== 'fitness') continue
    const until = x.validUntil?.toMillis?.() ?? Number(x.validUntil ?? 0)
    if (until > now && x.memberId) fitness.add(String(x.memberId))
  }

  const programs = await db.collection(`studios/${studioId}/programs`).get()
  const hasProgram = new Set(programs.docs.map((d) => String((d.data() as { memberId?: string }).memberId ?? '')))

  const targets = [...fitness].filter((m) => !hasProgram.has(m))
  const skipped = [...fitness].filter((m) => hasProgram.has(m))

  console.log(`${apply ? 'UYGULANIYOR' : 'KURU PROVA — hiçbir şey yazılmıyor'}`)
  console.log(`geçerli fitness paketi olan üye : ${fitness.size}`)
  console.log(`zaten programı olan (atlanacak) : ${skipped.length}`)
  console.log(`program atanacak                : ${targets.length}`)

  const hour = new Date(now + 3 * 3_600_000).getUTCHours()
  const quiet = hour >= 22 || hour < 8
  console.log(
    `\nbildirim: ${targets.length} üyeye "programın hazır" mesajı — ` +
      (quiet ? 'SESSİZ SAAT, kuyruğa girer ve 08:00’de çıkar' : 'HEMEN gider'),
  )

  if (!apply) {
    console.log('\nUygulamak için: --apply')
    process.exit(0)
  }

  const deps = { repo: new FirestoreTrainingRepository(db), clock: systemClock }
  let ok = 0
  const failed: string[] = []
  for (const memberId of targets) {
    const res = await instantiateTemplate(
      deps,
      ctx,
      { templateId, memberId: memberId as never, trainerId: 'mig_assign_program_a_20260731' as never },
      'migration',
    )
    if (res.ok) ok++
    else failed.push(`${memberId}: ${res.error.code}`)
  }

  console.log(`\n✅ ${ok} program atandı.`)
  if (failed.length) {
    console.log(`⚠️  ${failed.length} başarısız:`)
    failed.slice(0, 10).forEach((f) => console.log('   ', f))
  }
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
