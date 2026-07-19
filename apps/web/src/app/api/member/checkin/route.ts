import { type NextRequest } from 'next/server'

import { memberCheckInByToken } from '@/server/actions/qr'
import { withMember } from '@/server/member-api'

// The member scanned the kiosk's QR with her phone camera → check her in. The scanned token is a
// rotating, signed kiosk token; the server verifies it, burns it single-use, and records HER check-in.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { token?: string }
  return withMember(req, (ctx, memberId) => {
    if (!body.token) return Promise.resolve({ ok: false as const, error: { code: 'token_required' } })
    return memberCheckInByToken(ctx, memberId, body.token)
  })
}
