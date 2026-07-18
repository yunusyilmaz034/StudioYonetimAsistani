import { redirect } from 'next/navigation'

import { requirePageAccess } from '@/server/auth'
import { listUnreconciledCollectionsAction } from '@/server/actions/collections'
import { listProducts } from '@/server/catalog-query'
import { listMembers } from '@/server/members-query'

import { CollectionsScreen } from './collections-screen'

// PF-37 — the reconciliation queue. Shareable-link payments that arrived unattributed; reception finds
// who paid and adds her package here.
export default async function CollectionsPage() {
  const ctx = await requirePageAccess('/finance')
  if (!ctx) redirect('/login')
  const [collections, products, members] = await Promise.all([
    listUnreconciledCollectionsAction(),
    listProducts(ctx),
    listMembers(ctx),
  ])
  return (
    <CollectionsScreen
      collections={collections}
      products={products.filter((p) => p.active)}
      members={members.map((m) => ({ id: m.id as string, name: m.fullName, phone: m.phone as string }))}
    />
  )
}
