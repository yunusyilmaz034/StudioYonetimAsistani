import { type NextRequest } from 'next/server'

import { memberStoredWallet, withMember } from '@/server/member-api'

// The stored-value wallet: her prepaid balance + the history of loads and purchases.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  return withMember(req, (ctx, memberId) => memberStoredWallet(ctx, memberId))
}
