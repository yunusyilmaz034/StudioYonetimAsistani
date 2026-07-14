// `pnpm projections:rebuild` — delete the daily read model and replay the event log into it.
//
// This is NOT a migration and NOT a backfill: it touches no historical data, invents nothing, and
// can be run a hundred times with the same result. It is what "projections are disposable" MEANS —
// the property that makes it safe to have a projection at all. If the dashboard is ever wrong, we
// do not debug the counters; we delete them and replay the truth.
//
// Manual. Never in CI. Never deployed.
import { initializeApp } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'

import {
  DEFAULT_STUDIO_CONFIG,
  FirestoreProjectionRepository,
  instant,
  projectDaily,
  type StudioId,
  type TenantContext,
} from '@studio/core'

const PROJECT = process.env.GCLOUD_PROJECT ?? 'demo-sos'
if (!process.env.FIRESTORE_EMULATOR_HOST && !process.env.ALLOW_PRODUCTION) {
  console.error('Refusing to run against production without ALLOW_PRODUCTION=1.')
  process.exit(1)
}

initializeApp({ projectId: PROJECT })
const db = getFirestore()

const studioId = (process.argv[2] ?? 'std_demo') as StudioId
const ctx: TenantContext = {
  studioId,
  branchIds: [],
  role: 'owner',
  actor: { type: 'system', id: 'projection_rebuild' as never },
}

async function main(): Promise<void> {
  const repo = new FirestoreProjectionRepository(db)

  console.log(`Rebuilding the daily read model for ${studioId}…`)
  await repo.clearAll(ctx)

  // Replay in domain-time order, so `lastEventAt` ends where the log ends.
  const snap = await db
    .collection(`studios/${studioId}/events`)
    .orderBy('occurredAt', 'asc')
    .get()

  let folded = 0
  let counted = 0
  for (const doc of snap.docs) {
    const d = doc.data()
    const occurredAt = d.occurredAt instanceof Timestamp ? d.occurredAt.toMillis() : 0
    if (!occurredAt) continue
    // The watermark is LOG time — the clock `projection_lag` compares against. See the trigger.
    const recordedAt = d.recordedAt instanceof Timestamp ? d.recordedAt.toMillis() : occurredAt
    const inc = projectDaily(
      {
        type: d.type as string,
        occurredAt: instant(occurredAt),
        payload: (d.payload ?? {}) as Record<string, unknown>,
      },
      DEFAULT_STUDIO_CONFIG.utcOffsetMinutes,
    )
    await repo.applyOnce(ctx, doc.id, recordedAt, inc)
    folded++
    if (Object.keys(inc.counters).length > 0) counted++
  }

  // Every event is folded — an event that moves no counter still moves the watermark, which is what
  // `projection_lag` reads. The two numbers differ, and the difference is not an error.
  console.log(`✅ ${snap.size} event okundu, ${folded} tanesi işlendi, ${counted} tanesi bir sayacı oynattı.`)
  process.exit(0)
}

void main()
