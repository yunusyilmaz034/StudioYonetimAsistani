import { type NextRequest } from 'next/server'

import { loadMemberFitness } from '@/server/fitness-query'
import { withMember } from '@/server/member-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  return withMember(req, (ctx, memberId) => loadMemberFitness(ctx, memberId, Date.now()))
}
