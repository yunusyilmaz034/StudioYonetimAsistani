import { type NextRequest } from 'next/server'

import { createWalletTopupCheckout } from '@/server/actions/payments'
import { withMember } from '@/server/member-api'

// Load the wallet via virtual POS. Returns a PAYTR link the app opens in a WebView; the verified
// callback credits the balance. amountKurus is validated server-side; memberId comes from her token.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { amountKurus?: number }
  return withMember(req, (ctx, memberId) => {
    const amt = Number(body.amountKurus)
    if (!Number.isInteger(amt) || amt <= 0) return Promise.resolve({ ok: false as const, error: { code: 'invalid_amount' } })
    return createWalletTopupCheckout(ctx, memberId, amt)
  })
}
