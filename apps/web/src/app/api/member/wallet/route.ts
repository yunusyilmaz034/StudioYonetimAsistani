import { type NextRequest } from 'next/server'

import { loadPortalDashboard } from '@/server/portal-query'
import { withMember } from '@/server/member-api'

// The member wallet: what she owns (packages) and what she still owes (balanceDue). Payment history and
// in-app purchase are wired in M3; for now the balance + package view is real and live.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  return withMember(req, async (ctx, memberId) => {
    const dash = await loadPortalDashboard(ctx, memberId, Date.now())
    return {
      balanceDue: dash.balanceDue,
      packages: dash.packages.map((pk) => ({
        entitlementId: pk.entitlementId,
        productName: pk.productName,
        category: pk.category,
        remaining: pk.remaining,
        validUntil: pk.validUntil,
      })),
      history: [] as const,
    }
  })
}
