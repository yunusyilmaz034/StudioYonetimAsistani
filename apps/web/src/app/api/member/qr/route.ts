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
  // The body is not read at all any more — older app builds still send `branchId`, and ignoring it
  // is the fix (2026-08-20): the server resolves the branch, so every installed version is corrected
  // without a store release.
  return withMember(req, async (ctx, memberId) => {
    // The body's branchId is no longer read: the server resolves the branch (2026-08-20). Older
    // app builds keep sending it and are now fixed by that, without a store release.
    return mintCheckInToken(ctx, memberId)
  })
}
