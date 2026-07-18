import { type NextRequest } from 'next/server'

import { loadPortalDashboard } from '@/server/portal-query'
import { withMember } from '@/server/member-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  return withMember(req, (ctx, memberId) => loadPortalDashboard(ctx, memberId, Date.now()))
}
