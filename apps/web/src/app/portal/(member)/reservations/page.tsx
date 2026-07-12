import { requireMemberContext } from '@/server/auth'
import { loadPortalReservations } from '@/server/portal-query'

import { PortalReservationsScreen } from './reservations-screen'

export default async function PortalReservationsPage() {
  const { ctx, memberId } = await requireMemberContext()
  const data = await loadPortalReservations(ctx, memberId, Date.now())
  return <PortalReservationsScreen upcoming={data.upcoming} past={data.past} />
}
