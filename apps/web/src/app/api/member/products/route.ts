import { type NextRequest } from 'next/server'

import { memberBuyableProducts } from '@/server/member-api'
import { withMember } from '@/server/member-api'

// What she may buy from inside the app.
//
// TWO corrections over the first version of this endpoint, both found while building the renewal
// screen and both about money:
//
//   1. It returned every ACTIVE product. Active means "reception can sell it", not "a member may
//      buy it unattended" — the studio decides the second with `onlineSellable`, and PT is off for
//      exactly that reason. Selling a package the owner never opened for self-service is the studio
//      losing control of its own price list.
//   2. It returned the CASH price while checkout charges the card price. She would have seen 4.200
//      and been billed 4.620 — the kind of surprise that costs a customer, not a complaint.
//
// Both now match the public sales page, which had them right from the start.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  return withMember(req, (ctx) => memberBuyableProducts(ctx))
}
