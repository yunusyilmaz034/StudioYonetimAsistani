import { type NextRequest } from 'next/server'

import { memberRegisterDevice, withMember } from '@/server/member-api'

// M2 — the app posts its Expo push token here on launch/login. The token is stored server-side and
// push is turned on for her; delivery resolves the token at send time (PushProvider).
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { token?: string; platform?: string }
  return withMember(req, (ctx, memberId) => {
    if (!body.token) return Promise.resolve({ ok: false as const, error: { code: 'token_required' } })
    return memberRegisterDevice(ctx, memberId, body.token, body.platform ?? 'unknown')
  })
}
