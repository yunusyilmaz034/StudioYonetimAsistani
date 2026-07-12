import type { PrincipalRole } from '@studio/core'
import { redirect } from 'next/navigation'

import { getMemberClaims, getTenantContext } from '@/server/auth'
import { loadOwnerDashboard } from '@/server/owner-dashboard'

import { DashboardScreen } from './dashboard-screen'

// The owner dashboard IS the staff home (UX-8): the owner opens the product and immediately knows
// what needs attention today. v1.23 rebuilt it on the WIDGET contract over the daily read model —
// a fixed number of reads (1 projection + 5 bounded state queries, in parallel), whatever the size
// of the studio. It writes nothing and decides nothing.
export default async function HomePage() {
  const ctx = await getTenantContext()
  if (!ctx) {
    // A MEMBER holds a valid session cookie but is not staff: send her to her own home rather
    // than to the staff login she can never pass (DEBT-012).
    if (await getMemberClaims()) redirect('/portal')
    redirect('/login')
  }
  const data = await loadOwnerDashboard(ctx, Date.now())
  return <DashboardScreen data={data} roleLabel={roleLabel(ctx.role)} />
}

function roleLabel(role: PrincipalRole): string {
  switch (role) {
    case 'owner':
      return 'Sahip'
    case 'receptionist':
      return 'Resepsiyon'
    case 'trainer':
      return 'Eğitmen'
    default:
      return ''
  }
}
