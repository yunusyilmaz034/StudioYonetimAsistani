import type { PrincipalRole } from '@studio/core'

import { requirePageAccess } from '@/server/auth'
import { loadOwnerDashboard } from '@/server/owner-dashboard'
import { loadTodayOps } from '@/server/today-ops'

import { DashboardScreen } from './dashboard-screen'

// The owner dashboard IS the staff home (UX-8): the owner opens the product and immediately knows
// what needs attention today. v1.23 rebuilt it on the WIDGET contract over the daily read model —
// a fixed number of reads (1 projection + 5 bounded state queries, in parallel), whatever the size
// of the studio. It writes nothing and decides nothing.
// A TRAINER never reaches this page: `requirePageAccess` sends her to `/my-classes`, which is the
// only screen she has. She is staff, and she is also the person least entitled to the studio's
// data — so her home is not this one minus a few widgets; it is a different screen entirely.
export default async function HomePage() {
  const ctx = await requirePageAccess('/')
  const now = Date.now()
  const [data, todayOps] = await Promise.all([loadOwnerDashboard(ctx, now), loadTodayOps(ctx, now)])
  return <DashboardScreen data={data} todayOps={todayOps} role={ctx.role} roleLabel={roleLabel(ctx.role)} />
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
