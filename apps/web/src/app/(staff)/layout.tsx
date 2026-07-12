import type { ReactNode } from 'react'

import { AppShell } from '@/components/app-nav'

// The STAFF application shell — owner / reception / trainer only.
//
// It lives in a route group so that it is not merely *hidden* on member surfaces: it never
// enters their render tree at all. `/portal/*` and `/invite/*` sit outside this group, so the
// admin sidebar cannot leak into them through a forgotten condition — there is no condition.
export default function StaffLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>
}
