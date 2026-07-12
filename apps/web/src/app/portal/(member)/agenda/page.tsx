import { requireMemberContext } from '@/server/auth'
import { loadPortalAgenda } from '@/server/portal-query'

import { PortalAgendaScreen } from './agenda-screen'

export default async function PortalAgendaPage() {
  const { ctx, memberId } = await requireMemberContext()
  const data = await loadPortalAgenda(ctx, memberId, Date.now())
  return <PortalAgendaScreen data={data} />
}
