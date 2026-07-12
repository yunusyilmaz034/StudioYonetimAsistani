import { redirect } from 'next/navigation'

import { getTenantContext } from '@/server/auth'

import { AnalyticsScreen } from './analytics-screen'

// D25 — analytics on its own route, loaded lazily by the client (owner: charts must never slow the
// dashboard's first paint). Every number comes from the daily read model or the sessions; not one
// is maintained by hand.
export default async function AnalyticsPage() {
  const ctx = await getTenantContext()
  if (!ctx) redirect('/login')
  return <AnalyticsScreen />
}
