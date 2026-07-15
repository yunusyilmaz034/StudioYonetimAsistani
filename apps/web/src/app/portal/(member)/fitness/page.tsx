import { myFitnessAction } from '@/server/actions/fitness'

import { PortalFitnessScreen } from './fitness-screen'

// The member's own attendance — "Katılımım" (Plus Phase 8). Her streak and visit history, read from
// her verified session inside the action (no memberId parameter to forge). No occupancy of others,
// no names — only her own coming-and-going.
export default async function PortalFitnessPage() {
  const data = await myFitnessAction()
  return <PortalFitnessScreen data={data} />
}
