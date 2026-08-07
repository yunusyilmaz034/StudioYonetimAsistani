import { type NextRequest } from 'next/server'

import { crossOwnTurnstile } from '@/server/actions/turnstile'
import { withMember } from '@/server/member-api'

// The MEMBER scanned the screen. Everything that decides whether the arm turns happens server-side:
// the code's life, its single use, which device it belongs to, and her own presence.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as unknown
  return withMember(req, (ctx, memberId) => crossOwnTurnstile(ctx, memberId, body))
}
