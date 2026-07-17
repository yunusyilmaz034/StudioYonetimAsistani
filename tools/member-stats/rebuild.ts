// `pnpm member-stats:rebuild` — recompute Member.stats activity recency from the event log.
//
// `Member.stats.lastCheckInAt` / `lastAttendanceAt` are DENORMALISED and REBUILDABLE: the trigger maxes
// them forward on every new check-in / attendance, and this replays the whole log to recompute them
// from scratch. It is what makes the dormancy signal trustworthy on day one — without it, every
// existing member reads as "never active" and the churn list is a wall of false positives.
//
// Not a migration and not a backfill of history: it invents nothing, touches only the two derived
// fields, and is idempotent (a hundred runs → the same numbers). Manual. Never in CI. Never deployed.
import { initializeApp } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'

import { instant, memberActivityFromEvent, type StudioId } from '@studio/core'

const PROJECT = process.env.GCLOUD_PROJECT ?? process.env.FIREBASE_PROJECT_ID ?? 'demo-sos'
if (!process.env.FIRESTORE_EMULATOR_HOST && !process.env.ALLOW_PRODUCTION) {
  console.error('Refusing to run against production without ALLOW_PRODUCTION=1.')
  process.exit(1)
}

initializeApp({ projectId: PROJECT })
const db = getFirestore()

const studioId = (process.argv[2] ?? 'std_demo') as StudioId
const apply = process.argv.includes('--apply')

type Recency = { lastCheckInAt: number; lastAttendanceAt: number; lastBookingAt: number }
const emptyRecency = (): Recency => ({ lastCheckInAt: 0, lastAttendanceAt: 0, lastBookingAt: 0 })

async function main(): Promise<void> {
  console.log(`Üye aktivite recency'si yeniden hesaplanıyor: ${studioId}…`)

  const snap = await db
    .collection(`studios/${studioId}/events`)
    .orderBy('occurredAt', 'asc')
    .get()

  // Fold the log into per-member maxes in memory — one pass, then one write per member.
  const byMember = new Map<string, Recency>()
  let touched = 0
  for (const doc of snap.docs) {
    const d = doc.data()
    const occurredAt = d.occurredAt instanceof Timestamp ? d.occurredAt.toMillis() : 0
    if (!occurredAt) continue
    const touch = memberActivityFromEvent({
      type: d.type as string,
      occurredAt: instant(occurredAt),
      related: (d.related ?? null) as { memberId?: string | null } | null,
    })
    if (!touch) continue
    touched++
    const cur = byMember.get(touch.memberId) ?? emptyRecency()
    cur[touch.field] = Math.max(cur[touch.field], touch.at)
    byMember.set(touch.memberId, cur)
  }

  console.log(`${snap.size} event okundu, ${touched} tanesi aktivite (${byMember.size} üye).`)

  if (!apply) {
    console.log('DRY-RUN — hiçbir şey yazılmadı. Uygulamak için: --apply')
    for (const [mid, r] of [...byMember].slice(0, 10)) {
      console.log(`  ${mid}: checkIn=${r.lastCheckInAt || '-'} attendance=${r.lastAttendanceAt || '-'} booking=${r.lastBookingAt || '-'}`)
    }
    process.exit(0)
  }

  // One targeted field update per member (leaves the rest of the doc untouched), chunked into batches.
  const entries = [...byMember]
  let written = 0
  for (let i = 0; i < entries.length; i += 400) {
    const batch = db.batch()
    for (const [mid, r] of entries.slice(i, i + 400)) {
      const ref = db.doc(`studios/${studioId}/members/${mid}`)
      const update: Record<string, Timestamp> = {}
      if (r.lastCheckInAt > 0) update['stats.lastCheckInAt'] = Timestamp.fromMillis(r.lastCheckInAt)
      if (r.lastAttendanceAt > 0) update['stats.lastAttendanceAt'] = Timestamp.fromMillis(r.lastAttendanceAt)
      if (r.lastBookingAt > 0) update['stats.lastBookingAt'] = Timestamp.fromMillis(r.lastBookingAt)
      if (Object.keys(update).length > 0) batch.update(ref, update)
    }
    await batch.commit()
    written += Math.min(400, entries.length - i)
  }

  console.log(`✅ ${written} üyenin aktivite recency'si yazıldı.`)
  process.exit(0)
}

void main()
