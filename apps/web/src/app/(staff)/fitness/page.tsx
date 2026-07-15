import { redirect } from 'next/navigation'

import { requirePageAccess } from '@/server/auth'
import { loadOccupancyNow, loadStudioUsage } from '@/server/fitness-query'

import { FitnessScreen } from './fitness-screen'

// Katılım & Doluluk (Plus Phase 8). A read/report layer over the studio's existing check-ins: how
// busy it is right now, and how it has been used over the last 30 days. Owner + reception only.
export default async function FitnessPage() {
  const ctx = await requirePageAccess('/fitness')
  if (!ctx) redirect('/login')

  const [occupancy, usage] = await Promise.all([loadOccupancyNow(ctx), loadStudioUsage(ctx, Date.now())])
  return <FitnessScreen occupancy={occupancy} usage={usage} />
}
