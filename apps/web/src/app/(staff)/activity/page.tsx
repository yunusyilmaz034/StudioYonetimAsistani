import { redirect } from 'next/navigation'

import { requirePageAccess } from '@/server/auth'
import { resolveRange, type RangeId } from '@/lib/ranges'
import { loadFeed, type ActivityKind } from '@/server/activity-query'

import { ActivityScreen } from './activity-screen'

// The Activity Feed (Hareket Merkezi). Reception's working screen: who did what, to whom, when —
// to the second. The first page is server-rendered so the screen is useful before a single click.
export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ kinds?: string; range?: string; memberId?: string }>
}) {
  const ctx = await requirePageAccess('/activity')
  if (!ctx) redirect('/login')

  const sp = await searchParams
  const kinds = (sp.kinds?.split(',').filter(Boolean) ?? []) as ActivityKind[]
  const range = (sp.range ?? 'all') as RangeId
  const r = resolveRange(range, Date.now())

  const page = await loadFeed(ctx, {
    kinds,
    ...(range === 'all' ? {} : { fromMs: r.fromMs, toMs: r.toMs }),
    ...(sp.memberId ? { memberId: sp.memberId } : {}),
  })
  return <ActivityScreen initial={page} isOwner={ctx.role === 'owner'} />
}
