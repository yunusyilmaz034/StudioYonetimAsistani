import { requireTenantContext } from '@/server/auth'
import { listEngagementContentAction, segmentCountsAction } from '@/server/actions/engagement'

import { EngagementScreen } from './engagement-screen'

export const dynamic = 'force-dynamic'

export default async function EngagementPage() {
  const ctx = await requireTenantContext(['owner', 'platform_admin'])
  const [content, segments] = await Promise.all([listEngagementContentAction(), segmentCountsAction()])
  return <EngagementScreen initialContent={[...content]} segments={[...segments]} canManage={ctx?.role === 'owner'} />
}
