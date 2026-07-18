import { type NextRequest } from 'next/server'

import { leaveOwnFeedback } from '@/server/actions/training'
import { withMember } from '@/server/member-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as unknown
  return withMember(req, (ctx, memberId) => leaveOwnFeedback(ctx, memberId, body))
}
