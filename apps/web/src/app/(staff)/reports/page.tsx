import { redirect } from 'next/navigation'

import { requirePageAccess } from '@/server/auth'

import { ReportsScreen } from './reports-screen'

// The seven reports (v1.27 S6). Owner-only: reception does not get finance reports, and bulk export
// is the owner's alone (owner, 2026-07-13).
export default async function ReportsPage() {
  const ctx = await requirePageAccess('/reports')
  if (!ctx) redirect('/login')
  return <ReportsScreen />
}
