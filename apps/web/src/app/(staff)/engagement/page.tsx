import { requireTenantContext } from '@/server/auth'
import { engagementSuggestionsAction, listEngagementContentAction, segmentCountsAction } from '@/server/actions/engagement'

import { EngagementScreen } from './engagement-screen'

export const dynamic = 'force-dynamic'

export default async function EngagementPage() {
  const ctx = await requireTenantContext(['owner', 'receptionist', 'platform_admin'])
  const canManage = ctx?.role === 'owner'
  const [content, segments, suggestions] = await Promise.all([
    listEngagementContentAction(),
    segmentCountsAction(),
    canManage ? engagementSuggestionsAction() : Promise.resolve([]),
  ])
  return <EngagementScreen initialContent={[...content]} segments={[...segments]} initialSuggestions={[...suggestions]} canManage={canManage} />
}
