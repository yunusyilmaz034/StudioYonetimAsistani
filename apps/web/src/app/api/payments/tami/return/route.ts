import { NextResponse, type NextRequest } from 'next/server'

import { handleTamiReturn } from '@/server/tami-return'

// TAMI'DEN DÖNÜŞ UCU.
//
// The member's browser lands here after the hosted payment page, with the order id in the query.
// Nothing about that arrival is trusted: the handler asks TAMI whether the order was actually paid
// and only then completes it. See `server/tami-return.ts` for why a redirect can never be the proof.
//
// It is a GET because a browser redirect is a GET, and it is on the middleware's public allowlist
// because a member coming back from a payment page has no staff session and often no session at all.
//
// It always REDIRECTS rather than rendering JSON — the person on the other end is a customer who has
// just paid, not an integration. Where she lands is where she started: a link payment returns to the
// link page, everything else to the member portal.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest): Promise<Response> {
  const url = new URL(req.url)
  const sid = url.searchParams.get('s')?.trim() ?? ''
  // Tami echoes the order id; the parameter name has varied across its docs, so all three are read.
  const orderId = (url.searchParams.get('orderId') ?? url.searchParams.get('order_id') ?? url.searchParams.get('oid') ?? '').trim()
  const back = url.searchParams.get('back')?.trim() || '/portal'

  if (!sid || !orderId) {
    console.warn('[tami-return] missing params', { sid: Boolean(sid), orderId: Boolean(orderId) })
    return NextResponse.redirect(new URL(`${back}${back.includes('?') ? '&' : '?'}fail=1`, url.origin))
  }

  let ok = false
  try {
    const res = await handleTamiReturn(sid, orderId)
    ok = res.ok
  } catch (e) {
    // A thrown error here means we could not establish payment — which is the not-paid branch, not a
    // reason to show her a stack trace. The intent stays unsettled and reconciliation surfaces it.
    console.error('[tami-return] failed', (e as Error)?.message)
  }

  const sep = back.includes('?') ? '&' : '?'
  return NextResponse.redirect(new URL(`${back}${sep}${ok ? 'ok=1' : 'fail=1'}`, url.origin))
}
