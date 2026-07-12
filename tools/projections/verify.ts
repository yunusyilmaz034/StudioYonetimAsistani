// `pnpm projections:verify` — recompute every day from the event log and diff it against the
// stored read model.
//
// A projection you cannot audit is a second source of truth. This is the audit: same log, same pure
// fold, and the numbers must match exactly. If they do not, the projection is wrong (never the log)
// and `pnpm projections:rebuild` heals it.
import { initializeApp } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'

import {
  applyIncrement,
  DEFAULT_STUDIO_CONFIG,
  emptyDaily,
  FirestoreProjectionRepository,
  instant,
  projectDaily,
  type DailyReadModel,
  type StudioId,
  type TenantContext,
} from '@studio/core'

const PROJECT = process.env.GCLOUD_PROJECT ?? 'demo-sos'
initializeApp({ projectId: PROJECT })
const db = getFirestore()

const studioId = (process.argv[2] ?? 'std_demo') as StudioId
const ctx: TenantContext = {
  studioId,
  branchIds: [],
  role: 'owner',
  actor: { type: 'system', id: 'projection_verify' as never },
}

const COUNTERS: readonly (keyof DailyReadModel)[] = [
  'bookings',
  'cancellations',
  'moves',
  'checkIns',
  'attended',
  'noShow',
  'autoResolved',
  'waitlistJoined',
  'waitlistPromoted',
  'newMembers',
  'salesKurus',
  'collectedKurus',
]

async function main(): Promise<void> {
  // 1. Fold the log, independently of whatever the trigger wrote.
  const snap = await db.collection(`studios/${studioId}/events`).orderBy('occurredAt', 'asc').get()
  const expected = new Map<string, DailyReadModel>()
  for (const doc of snap.docs) {
    const d = doc.data()
    const occurredAt = d.occurredAt instanceof Timestamp ? d.occurredAt.toMillis() : 0
    if (!occurredAt) continue
    const inc = projectDaily(
      {
        type: d.type as string,
        occurredAt: instant(occurredAt),
        payload: (d.payload ?? {}) as Record<string, unknown>,
      },
      DEFAULT_STUDIO_CONFIG.utcOffsetMinutes,
    )
    if (!inc) continue
    const current = expected.get(inc.date) ?? emptyDaily(inc.date)
    expected.set(inc.date, applyIncrement(current, inc, occurredAt))
  }

  // 2. Compare with what is stored.
  const repo = new FirestoreProjectionRepository(db)
  const dates = [...expected.keys()].sort()
  let mismatches = 0

  for (const date of dates) {
    const want = expected.get(date)!
    const got = await repo.getDaily(ctx, date)
    if (!got) {
      console.log(`❌ ${date}: read model yok (rebuild gerekiyor)`)
      mismatches++
      continue
    }
    const diffs = COUNTERS.filter((k) => want[k] !== got[k]).map(
      (k) => `${String(k)}: beklenen ${String(want[k])}, kayıtlı ${String(got[k])}`,
    )
    if (diffs.length > 0) {
      console.log(`❌ ${date}: ${diffs.join(' · ')}`)
      mismatches++
    } else {
      console.log(`✅ ${date}: ${want.bookings} rez · ${want.cancellations} iptal · ${want.checkIns} check-in · ${want.salesKurus / 100} ₺ satış`)
    }
  }

  console.log(
    mismatches === 0
      ? `\n✅ ${dates.length} gün doğrulandı — read model event log ile birebir aynı.`
      : `\n❌ ${mismatches} günde fark var. \`pnpm projections:rebuild\` çalıştırın.`,
  )
  process.exit(mismatches === 0 ? 0 : 1)
}

void main()
