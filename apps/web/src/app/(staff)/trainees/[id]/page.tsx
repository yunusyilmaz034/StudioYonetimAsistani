import { notFound } from 'next/navigation'

import { requirePageAccess } from '@/server/auth'
import { loadTrainee } from '@/server/trainee-query'

import { TraineeScreen } from './trainee-screen'

// One member, as her trainer sees her: the name, what is active today, and the training work —
// programmes, measurements, photos. The training panel below is the SAME component the owner uses on
// the member card, because the actions behind it were already trainer-authorised
// (`TRAINER = ['owner','trainer','platform_admin']` in server/actions/training.ts). What was missing
// was never the permission; it was a screen she could reach without also reaching the phone and the
// money that share the member card with it.
export default async function TraineePage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePageAccess('/trainees')
  const { id } = await params
  const trainee = await loadTrainee(ctx, id, Date.now())
  if (!trainee) notFound()
  return <TraineeScreen trainee={trainee} studioId={ctx.studioId} />
}
