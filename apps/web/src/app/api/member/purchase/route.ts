import { type NextRequest } from 'next/server'

import { createMemberPackageCheckout } from '@/server/actions/payments'
import { withMember } from '@/server/member-api'

// M3 — the member buys a package. Returns a PAYTR link the app opens in a WebView; the existing
// verified callback grants the package on success. memberId comes from her token, never the request.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { productId?: string }
  return withMember(req, (ctx, memberId) => {
    if (!body.productId) return Promise.resolve({ ok: false as const, error: { code: 'product_required' } })
    return createMemberPackageCheckout(ctx, memberId, body.productId)
  })
}
