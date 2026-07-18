import { type NextRequest } from 'next/server'

import { bookOwnReservation } from '@/server/actions/portal'
import { withMember } from '@/server/member-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as unknown
  return withMember(req, (ctx, memberId) => bookOwnReservation(ctx, memberId, body))
}
