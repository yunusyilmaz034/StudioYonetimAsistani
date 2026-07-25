import { requirePageAccess } from '@/server/auth'
import { listInviteStatusAction } from '@/server/actions/portal-onboarding'

import { InviteScreen } from './invite-screen'

// PORTAL ONBOARDING — the screen that turns "119 migrated members" into "119 members with an
// account". Reads the rollout state once, server-side; every send is an explicit operator act on
// the client screen.
export default async function BulkInvitePage() {
  await requirePageAccess('/members')
  const summary = await listInviteStatusAction()
  return <InviteScreen
      rows={summary.rows}
      todayInvited={summary.todayInvited}
      todayActivated={summary.todayActivated}
      yesterdayInvited={summary.yesterdayInvited}
      yesterdayActivated={summary.yesterdayActivated}
    />
}
