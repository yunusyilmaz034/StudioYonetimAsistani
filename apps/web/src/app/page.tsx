import type { StaffRole } from '@studio/core'
import { redirect } from 'next/navigation'

import { getTenantContext } from '@/server/auth'
import { loadDashboard } from '@/server/dashboard-query'

import { DashboardScreen } from './dashboard-screen'

// The owner dashboard IS the staff home (D7, UX-8): the owner opens the product and
// immediately knows — and can act on — what needs attention today. Direct bounded reads
// (no projection, D1); the dashboard writes nothing.
export default async function HomePage() {
  const ctx = await getTenantContext()
  if (!ctx) {
    redirect('/login')
  }
  const data = await loadDashboard(ctx, Date.now())
  return <DashboardScreen data={data} roleLabel={roleLabel(ctx.role)} />
}

function roleLabel(role: StaffRole): string {
  switch (role) {
    case 'owner':
      return 'Sahip'
    case 'receptionist':
      return 'Resepsiyon'
    case 'trainer':
      return 'Eğitmen'
  }
}
