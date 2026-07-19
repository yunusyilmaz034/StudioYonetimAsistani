import { type NextRequest } from 'next/server'

import { listProducts } from '@/server/catalog-query'
import { withMember } from '@/server/member-api'

// The catalogue she can buy from the app — active products only, just what a purchase card shows.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  return withMember(req, async (ctx) => {
    const products = await listProducts(ctx)
    return products
      .filter((p) => p.active)
      .map((p) => ({ id: p.id, name: p.name, priceInKurus: p.priceInKurus, category: p.category, durationDays: p.durationDays }))
  })
}
