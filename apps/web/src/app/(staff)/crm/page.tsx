import { redirect } from 'next/navigation'

import { requirePageAccess } from '@/server/auth'
import { loadFunnelAction } from '@/server/actions/crm'

import { CrmScreen } from './crm-screen'

// The funnel. A lead is NOT a member (owner, decision 6): she converts, explicitly, and the lead
// closes. Nothing on this screen touches a credit or a reservation.
export default async function CrmPage() {
  const ctx = await requirePageAccess('/crm')
  if (!ctx) redirect('/login')
  const funnel = await loadFunnelAction()
  return <CrmScreen initial={funnel} />
}
