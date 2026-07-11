import { notFound, redirect } from 'next/navigation'

import { getTenantContext } from '@/server/auth'
import { listProducts } from '@/server/catalog-query'
import { loadMemberWorkspace } from '@/server/member-workspace-query'

import { MemberWorkspaceScreen } from './member-workspace-screen'

// The Member Workspace (v1.18): reception's single-screen operations centre for one
// member. Direct bounded parallel reads (D2) — no projection. The Packages and Payments
// sections load subscriptions client-side via the existing action.
export default async function MemberWorkspacePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const ctx = await getTenantContext()
  if (!ctx) {
    redirect('/login')
  }

  const { id } = await params
  const [data, products] = await Promise.all([
    loadMemberWorkspace(ctx, id, Date.now()),
    listProducts(ctx),
  ])
  if (!data) {
    notFound()
  }

  return (
    <MemberWorkspaceScreen data={data} products={products} defaultBranchId={ctx.branchIds[0] ?? null} />
  )
}
