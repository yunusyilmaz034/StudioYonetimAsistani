import type { PrincipalRole } from '@studio/core'
import { redirect } from 'next/navigation'

import { getMemberClaims, getTenantContext } from '@/server/auth'
import { loadDashboard } from '@/server/dashboard-query'

import { DashboardScreen } from './dashboard-screen'

// The owner dashboard IS the staff home (D7, UX-8): the owner opens the product and
// immediately knows — and can act on — what needs attention today. Direct bounded reads
// (no projection, D1); the dashboard writes nothing.
export default async function HomePage() {
  const ctx = await getTenantContext()
  if (!ctx) {
    // A MEMBER holds a valid session cookie but is not staff: send her to her own home rather
    // than to the staff login she can never pass (and which would bounce her back — DEBT-012).
    if (await getMemberClaims()) redirect('/portal')
    redirect('/login')
  }
  const data = await loadDashboard(ctx, Date.now())
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
    case 'member':
      // Unreachable: the staff guard never returns a member context. Present so the switch
      // stays exhaustive if the principal set ever grows.
      return 'Üye'
  }
}
