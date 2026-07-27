import { Suspense } from 'react'
import { redirect } from 'next/navigation'

import { requirePageAccess } from '@/server/auth'

import { ReportsScreen } from './reports-screen'

// The reports (v1.27 S6; the trend joined them in PF-40). Owner-only: reception does not get finance
// reports, and bulk export is the owner's alone (owner, 2026-07-13).
//
// The Suspense boundary is required, not decorative: the screen reads `?r=` to pick a report, and
// `useSearchParams` opts a component out of prerendering unless it sits inside one.
export default async function ReportsPage() {
  const ctx = await requirePageAccess('/reports')
  if (!ctx) redirect('/login')
  return (
    <Suspense fallback={null}>
      <ReportsScreen />
    </Suspense>
  )
}
