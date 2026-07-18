import { type NextRequest } from 'next/server'

import { mintCheckInToken, qrStudioBranch } from '@/server/actions/qr'
import { withMember } from '@/server/member-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET — her studio + home branch (a member has no branch claim). POST — mint a short-lived signed
// check-in token she DISPLAYS; reception scans it. The HMAC secret and jti burn stay server-side.
export async function GET(req: NextRequest) {
  return withMember(req, (ctx, memberId) => qrStudioBranch(ctx, memberId))
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { branchId?: string }
  return withMember(req, async (ctx, memberId) => {
    if (!body.branchId) return { ok: false as const, error: { code: 'branch_required' } }
    return mintCheckInToken(ctx, memberId, body.branchId)
  })
}
