import { requirePageAccess } from '@/server/auth'
import { listTraineeRows } from '@/server/trainee-query'

import { TraineesScreen } from './trainees-screen'

// ÜYELER, the trainer's version (owner, 2026-08-30). Names and active packages — the two things a
// lesson is planned against — and nothing else. The phone, the balance, the payments and the package
// history are not filtered out on the client; they are never read (see `server/trainee-query.ts`).
export default async function TraineesPage() {
  const ctx = await requirePageAccess('/trainees')
  const rows = await listTraineeRows(ctx, Date.now())
  return <TraineesScreen rows={rows} />
}
