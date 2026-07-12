import { redirect } from 'next/navigation'

import { Toaster } from '@/components/ui/sonner'
import { requireMemberContext } from '@/server/auth'
import { getMemberClaims } from '@/server/auth'
import { loadPortalProfile } from '@/server/portal-query'

import { MemberPortalShell } from '../portal-shell'

// The GUARDED half of the portal.
//
// `/portal/login` and `/invite/*` deliberately sit OUTSIDE this route group: if login were
// inside, this layout would redirect it to itself — an infinite loop for the one visitor who by
// definition has no session yet.
//
// And note what is NOT here: the staff `AppShell`. It lives in `(staff)/layout.tsx`, a different
// branch of the tree, so an admin sidebar cannot reach a member's HTML at all.
export default async function MemberLayout({ children }: { children: React.ReactNode }) {
  const claims = await getMemberClaims()
  if (!claims) redirect('/portal/login')

  const { ctx, memberId } = await requireMemberContext()
  const profile = await loadPortalProfile(ctx, memberId)

  return (
    <MemberPortalShell studioId={claims.studioId} memberName={profile.fullName}>
      <Toaster />
      {children}
    </MemberPortalShell>
  )
}
