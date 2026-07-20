import { requireTenantContext } from '@/server/auth'
import { listBugReportsAction } from '@/server/actions/feedback'

import { FeedbackScreen } from './feedback-screen'

export const dynamic = 'force-dynamic'

export default async function FeedbackPage() {
  await requireTenantContext(['owner', 'platform_admin'])
  const reports = await listBugReportsAction()
  return <FeedbackScreen initial={[...reports]} />
}
