import { requireTenantContext } from '@/server/auth'
import { listKnowledgeArticlesAction } from '@/server/actions/knowledge'

import { KnowledgeScreen } from './knowledge-screen'

export const dynamic = 'force-dynamic'

export default async function KnowledgePage() {
  const ctx = await requireTenantContext(['owner', 'receptionist', 'trainer', 'platform_admin'])
  const articles = await listKnowledgeArticlesAction()
  return <KnowledgeScreen initial={[...articles]} canManage={ctx?.role === 'owner'} />
}
