import { redirect } from 'next/navigation'

import { requirePageAccess } from '@/server/auth'
import { loadUnmatchedCollections } from '@/server/unmatched-collections'

import { FinanceScreen } from './finance-screen'

// Kasa & gün sonu. The screen the studio's money actually passes through.
export default async function FinancePage() {
  const ctx = await requirePageAccess('/finance')
  if (!ctx) redirect('/login')
  // EŞLEŞTİRİLECEK ÖDEMELER BURADAN GÖRÜNÜR (owner, 2026-11-18): *"ben göremiyorum eşleşmeyen ödeme diye."* The
  // reconciliation screen existed but no menu led to it; money that belongs to nobody sat there unseen. The
  // till is where the desk looks for money, so the count is shown here. A failed read never blocks the till.
  const unmatched = await loadUnmatchedCollections(ctx)
  return <FinanceScreen isOwner={ctx.role === 'owner'} unmatched={unmatched} />
}
