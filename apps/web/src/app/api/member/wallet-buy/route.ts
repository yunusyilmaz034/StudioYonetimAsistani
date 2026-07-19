import { type NextRequest } from 'next/server'

import { memberBuyFromWallet, withMember } from '@/server/member-api'

// Buy a retail item from the wallet balance. The productId/quantity are validated server-side; the
// memberId comes from her token, and the finance sale enforces I-37 (never spends below zero).
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { productId?: string; quantity?: number }
  return withMember(req, (ctx, memberId) => {
    if (!body.productId) return Promise.resolve({ ok: false as const, error: { code: 'product_required' } })
    return memberBuyFromWallet(ctx, memberId, body.productId, body.quantity ?? 1)
  })
}
