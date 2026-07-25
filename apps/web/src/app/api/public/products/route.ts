import { NextResponse } from 'next/server'

import { getPublicProductsAction } from '@/server/actions/payments'

// ONLINE ÜYELİK SATIŞI — the studio's online price list, as JSON, for the marketing site.
//
// WHY THIS EXISTS. `pilatesfitnessbyisil.com` is a separate static site (Firebase Hosting), so it
// cannot call a Server Action. Without this endpoint its package prices would be hand-typed HTML —
// a second copy of the catalogue that silently drifts the day the owner edits a price in the panel.
// AD-41 says the catalogue is DATA; this is what lets a static page honour that.
//
// It exposes exactly what the public `/uyelik` page already renders to anyone with the link: the
// online-sellable products, their names, durations and card-inclusive totals. No PII, no secrets, no
// member-scoped anything. The studio is named by `?s=`, the same way the sales page is.
export const dynamic = 'force-dynamic'

const CORS: Record<string, string> = {
  // Read-only public data — the same bytes the sales page shows. Any origin may read it, which is
  // what lets the marketing site (and a future landing page) render live prices.
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  // A price change should reach the site quickly, but not cost a Firestore read per visitor.
  'Cache-Control': 'public, max-age=120, s-maxage=120',
}

export async function GET(req: Request): Promise<Response> {
  const studioId = new URL(req.url).searchParams.get('s')?.trim() ?? ''
  if (!studioId) return NextResponse.json({ ok: false as const, error: 'missing_studio' }, { status: 400, headers: CORS })

  try {
    const res = await getPublicProductsAction({ studioId })
    return NextResponse.json(res, { headers: CORS })
  } catch {
    // An unknown studio or an unreachable Firestore is not a 500 the site should render a stack for:
    // it falls back to "call us on WhatsApp".
    return NextResponse.json({ ok: false as const, error: 'unavailable' }, { status: 200, headers: CORS })
  }
}

export function OPTIONS(): Response {
  return new Response(null, { status: 204, headers: CORS })
}
