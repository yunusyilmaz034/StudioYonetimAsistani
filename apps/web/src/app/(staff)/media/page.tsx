import { requireTenantContext } from '@/server/auth'
import { listMediaAction } from '@/server/actions/media'

import { MediaScreen } from './media-screen'

export const dynamic = 'force-dynamic'

export default async function MediaPage() {
  const ctx = await requireTenantContext(['owner', 'receptionist', 'platform_admin'])
  const items = await listMediaAction()
  return <MediaScreen initial={[...items]} canManage={ctx?.role === 'owner'} />
}
