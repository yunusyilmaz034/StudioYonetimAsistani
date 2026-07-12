import type { ReactNode } from 'react'

import { AppShell } from '@/components/app-nav'
import { getTenantContext } from '@/server/auth'

// The STAFF application shell — owner / reception / trainer only.
//
// It lives in a route group so that it is not merely *hidden* on member surfaces: it never
// enters their render tree at all. `/portal/*` and `/invite/*` sit outside this group, so the
// admin sidebar cannot leak into them through a forgotten condition — there is no condition.
export default async function StaffLayout({ children }: { children: ReactNode }) {
  // The Audit Log is the owner's alone (2026-07-13), so the nav is built from the role — not
  // merely CSS-hidden. A link reception cannot follow has no business being drawn.
  const ctx = await getTenantContext()
  return <AppShell isOwner={ctx?.role === 'owner'}>{children}</AppShell>
}
