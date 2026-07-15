import { notFound } from 'next/navigation'

import { requirePageAccess } from '@/server/auth'
import { listTrainersAction } from '@/server/actions/bulk-reservations'
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
  const ctx = await requirePageAccess('/members')

  const { id } = await params
  const [data, products, trainers] = await Promise.all([
    loadMemberWorkspace(ctx, id, Date.now()),
    listProducts(ctx),
    // The trainers, for the Member Override "eğitmen kısıtı" picker (Plus Phase 4) — the same
    // reception-readable source the schedule and bulk screens use.
    listTrainersAction(),
  ])
  if (!data) {
    notFound()
  }

  return (
    <MemberWorkspaceScreen
      data={data}
      products={products}
      trainers={trainers}
      defaultBranchId={ctx.branchIds[0] ?? null}
      isOwner={ctx.role === 'owner'}
      // KVKK erasure is the ONE destructive act in this product, and it belongs to the person who set
      // the studio up — not to any owner added from the staff screen. The domain refuses everyone
      // else regardless; this only decides whether the button is drawn.
      isPlatformAdmin={ctx.actor.type === 'platform_admin'}
      // Training content (programmes, measurements, photos) is owner/platform_admin; reception gets a
      // boolean only. The training actions refuse reception regardless — this only picks the view.
      canManageTraining={ctx.role === 'owner' || ctx.actor.type === 'platform_admin'}
    />
  )
}
