import { redirect } from 'next/navigation'

import { getTenantContext } from '@/server/auth'
import { loadFeed } from '@/server/activity-query'

import { ActivityScreen } from './activity-screen'

// The Activity Feed (Hareket Merkezi). Reception's working screen: who did what, to whom, when —
// to the second. The first page is server-rendered so the screen is useful before a single click.
export default async function ActivityPage() {
  const ctx = await getTenantContext()
  if (!ctx) redirect('/login')

  const page = await loadFeed(ctx, {})
  return <ActivityScreen initial={page} />
}
