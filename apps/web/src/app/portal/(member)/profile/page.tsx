import { requireMemberContext } from '@/server/auth'
import { loadPortalProfile } from '@/server/portal-query'

import { PortalProfileScreen } from './profile-screen'

export default async function PortalProfilePage() {
  const { ctx, memberId } = await requireMemberContext()
  const profile = await loadPortalProfile(ctx, memberId)
  return <PortalProfileScreen studioId={ctx.studioId} {...profile} />
}
