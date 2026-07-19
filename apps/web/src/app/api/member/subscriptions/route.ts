import { type NextRequest } from 'next/server'

import { memberSubscriptions, withMember } from '@/server/member-api'

// Her subscriptions — active + past — for the subscriptions detail screen.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  return withMember(req, (ctx, memberId) => memberSubscriptions(ctx, memberId))
}
