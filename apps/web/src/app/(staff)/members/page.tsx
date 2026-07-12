import { redirect } from 'next/navigation'

import { getTenantContext } from '@/server/auth'
import { listMembers } from '@/server/members-query'

import { MembersScreen } from './members-screen'

// Server component: authenticate, then read the studio's members once (server-side)
// and hand them to the client screen, which searches the cached list locally
// (DEBT-001). Writes go through Server Actions (owner + reception).
export default async function MembersPage({
  searchParams,
}: {
  searchParams: Promise<{ member?: string; new?: string }>
}) {
  const ctx = await getTenantContext()
  if (!ctx) {
    redirect('/login')
  }

  const { member, new: create } = await searchParams
  // Legacy drill-through: a member id now opens its dedicated workspace (v1.18, D1).
  if (member) {
    redirect(`/members/${member}`)
  }

  const members = await listMembers(ctx)

  return (
    <MembersScreen
      members={members}
      defaultBranchId={ctx.branchIds[0] ?? null}
      initialCreate={create === '1'}
    />
  )
}
