import { type NextRequest } from 'next/server'

import { updateOwnProfile } from '@/server/actions/portal'
import { loadPortalProfile } from '@/server/portal-query'
import { withMember } from '@/server/member-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  return withMember(req, (ctx, memberId) => loadPortalProfile(ctx, memberId))
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as unknown
  return withMember(req, (ctx, memberId) => updateOwnProfile(ctx, memberId, body))
}
