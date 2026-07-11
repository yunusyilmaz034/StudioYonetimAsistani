import { redirect } from 'next/navigation'

import { getTenantContext } from '@/server/auth'
import { listProducts } from '@/server/catalog-query'
import { listMembers } from '@/server/members-query'

import { MembersScreen } from './members-screen'

// Server component: authenticate, then read the studio's members once (server-side)
// and hand them to the client screen, which searches the cached list locally
// (DEBT-001). Writes go through Server Actions (owner + reception).
export default async function MembersPage() {
  const ctx = await getTenantContext()
  if (!ctx) {
    redirect('/login')
  }

  const [members, products] = await Promise.all([listMembers(ctx), listProducts(ctx)])

  return <MembersScreen members={members} products={products} defaultBranchId={ctx.branchIds[0] ?? null} />
}
