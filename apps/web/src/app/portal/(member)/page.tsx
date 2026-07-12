import { requireMemberContext } from '@/server/auth'
import { loadPortalDashboard } from '@/server/portal-query'

import { PortalDashboardScreen } from './dashboard-screen'

export default async function PortalHome() {
  const { ctx, memberId } = await requireMemberContext()
  const data = await loadPortalDashboard(ctx, memberId, Date.now())
  return <PortalDashboardScreen data={data} />
}
