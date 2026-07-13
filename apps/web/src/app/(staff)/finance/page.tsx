import { redirect } from 'next/navigation'

import { requirePageAccess } from '@/server/auth'

import { FinanceScreen } from './finance-screen'

// Kasa & gün sonu. The screen the studio's money actually passes through.
export default async function FinancePage() {
  const ctx = await requirePageAccess('/finance')
  if (!ctx) redirect('/login')
  return <FinanceScreen isOwner={ctx.role === 'owner'} />
}
