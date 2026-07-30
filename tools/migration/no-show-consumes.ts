// BREAK-GLASS — a no-show consumes the credit (owner, 2026-07-30).
//
//   pnpm tsx tools/migration/no-show-consumes.ts <studioId>            ← dry run, writes nothing
//   pnpm tsx tools/migration/no-show-consumes.ts <studioId> --apply
//
// ── Why ─────────────────────────────────────────────────────────────────────────────────────
//
// Every service carried `noShowConsumesCredit: false`, which produced an asymmetry nobody could
// defend:
//
//   nobody marked anything   → default `attended` → credit CONSUMED
//   trainer marked "geldi"   → credit CONSUMED
//   trainer marked "gelmedi" → credit REFUNDED
//
// The same absent member got a different answer depending on whether a human bothered to mark her,
// and the diligent action was the generous one. The owner's rule is one line: *iptal etmediyse
// kredi düşer.* This makes the setting say that.
//
// It has never fired — the studio has recorded zero no-shows in its history — so nothing is being
// corrected retroactively. This closes a door before anyone walks through it.
//
// ── What it does NOT touch ──────────────────────────────────────────────────────────────────
//
// Already-scheduled sessions keep the policy snapshot they were created with. That snapshot exists
// precisely so a rule change cannot reach a class people have already booked, and reaching into it
// here would be the exact thing the snapshot is for preventing. The new rule applies to every
// session created from now on; the ones already on the calendar age out within days.
//
// It goes through `publishServicePolicy`, not a Firestore write: the policy version is bumped and an
// event is emitted, so "when did this change and who changed it" has an answer (#1, and the standing
// rule that production data is never edited by hand).
import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

import {
  FirestoreSchedulingRepository,
  publishServicePolicy,
  systemClock,
  type SchedulingPolicy,
  type ServiceId,
  type StudioId,
  type TenantContext,
} from '@studio/core'

const studioId = (process.argv[2] ?? '') as StudioId
const apply = process.argv.includes('--apply')
if (!studioId) {
  console.error('kullanım: no-show-consumes.ts <studioId> [--apply]')
  process.exit(1)
}

const PROJECT = process.env.GCLOUD_PROJECT ?? 'demo-sos'
initializeApp({ projectId: PROJECT })
const db = getFirestore()

// A break-glass script is an actor in its own right — it never borrows a human's identity (#5).
const ctx: TenantContext = {
  studioId,
  branchIds: [],
  role: 'platform_admin',
  actor: { type: 'platform_admin', id: 'break_glass_no_show_consumes' },
}

async function main(): Promise<void> {
  const repo = new FirestoreSchedulingRepository(db)
  const deps = { repo, clock: systemClock }
  const snap = await db.collection(`studios/${studioId}/services`).get()

  console.log(`${apply ? 'UYGULANIYOR' : 'KURU PROVA — hiçbir şey yazılmıyor'} · ${snap.size} servis\n`)

  let changed = 0
  for (const doc of snap.docs) {
    const data = doc.data()
    const policy = data.policy as SchedulingPolicy
    const name = String(data.name ?? doc.id)

    if (policy.noShowConsumesCredit === true) {
      console.log(`  = ${name.padEnd(20)} zaten true, dokunulmadı`)
      continue
    }

    console.log(`  → ${name.padEnd(20)} noShowConsumesCredit: false → true`)
    changed++
    if (!apply) continue

    const res = await publishServicePolicy(deps, ctx, {
      serviceId: doc.id as ServiceId,
      policy: { ...policy, noShowConsumesCredit: true },
    })
    if (!res.ok) console.error(`    HATA: ${res.error.code}`)
  }

  console.log(`\n${changed} servis ${apply ? 'güncellendi' : 'güncellenecek'}.`)
  if (!apply && changed > 0) console.log('Uygulamak için: --apply')
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
