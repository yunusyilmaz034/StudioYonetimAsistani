import { redirect } from 'next/navigation'

import { requirePageAccess } from '@/server/auth'
import { loadAdvisor } from '@/server/advisor-query'

import { AdvisorScreen } from './advisor-screen'

// AI Insights L1 — "Öneriler". A ranked, self-clearing to-do built from the owner dashboard's facts
// (one bounded read). It suggests; it never acts — every item links to a tool the owner already has.
export default async function AdvisorPage() {
  const ctx = await requirePageAccess('/advisor')
  if (!ctx) redirect('/login')
  const items = await loadAdvisor(ctx)
  return <AdvisorScreen items={items} />
}
