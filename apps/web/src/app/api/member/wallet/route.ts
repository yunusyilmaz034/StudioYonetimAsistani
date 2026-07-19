import { type NextRequest } from 'next/server'

import { memberPaymentHistory } from '@/server/actions/payments'
import { loadPortalDashboard } from '@/server/portal-query'
import { withMember } from '@/server/member-api'

// The member wallet: what she owns (packages), what she still owes (balanceDue), and her paid history.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  return withMember(req, async (ctx, memberId) => {
    const [dash, history] = await Promise.all([
      loadPortalDashboard(ctx, memberId, Date.now()),
      memberPaymentHistory(ctx, memberId),
    ])
    return {
      balanceDue: dash.balanceDue,
      packages: dash.packages.map((pk) => ({
        entitlementId: pk.entitlementId,
        productName: pk.productName,
        category: pk.category,
        remaining: pk.remaining,
        validUntil: pk.validUntil,
      })),
      history,
    }
  })
}
