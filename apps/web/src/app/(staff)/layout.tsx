import type { ReactNode } from 'react'

import { AppShell } from '@/components/app-nav'
import { getTenantContext } from '@/server/auth'

// The STAFF application shell — owner / reception / trainer only.
//
// It lives in a route group so that it is not merely *hidden* on member surfaces: it never
// enters their render tree at all. `/portal/*` and `/invite/*` sit outside this group, so the
// admin sidebar cannot leak into them through a forgotten condition — there is no condition.
export default async function StaffLayout({ children }: { children: ReactNode }) {
  const ctx = await getTenantContext()

  // No session, no shell. There is deliberately NO fallback role: guessing a role in order to draw
  // a navigation is how you draw the reception menu for somebody who is not reception. Every page
  // inside this layout runs `requirePageAccess`, which redirects an unauthenticated visitor to
  // `/login` — so an empty frame here is what a signed-out request sees for the instant before it
  // is sent away, and it shows her nothing.
  if (!ctx) return <>{children}</>

  // The nav is DERIVED from the permission matrix (`lib/permissions.ts`) — the same table the page
  // guard reads. A link nobody may follow is never drawn, and the two can never disagree, because
  // there is only one of them.
  return <AppShell role={ctx.role}>{children}</AppShell>
}
