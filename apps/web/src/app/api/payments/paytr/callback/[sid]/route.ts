import type { NextRequest } from 'next/server'

import { handlePaytrCallback } from '@/server/payment-callback'

// ── PAYTR server-to-server callback, PATH-scoped tenant (Plus Phase 6). ──────────────────────
//
// Same contract as ../route.ts, but the studio id rides in the PATH (`…/callback/{sid}`) instead of
// a `?sid=` query. PAYTR does not reliably call back a callback_link that carries a query string, so
// the link's callback_link now points here. The route is UNAUTHENTICATED because PAYTR is the caller —
// the notification hash IS the authentication (verified inside handlePaytrCallback). The old query
// route stays for any in-flight links created before this change.

export async function POST(req: NextRequest, { params }: { params: Promise<{ sid: string }> }): Promise<Response> {
  const { sid } = await params
  if (!sid) return new Response('MISSING_SID', { status: 400 })

  const form = await req.formData().catch(() => null)
  if (!form) return new Response('BAD_REQUEST', { status: 400 })
  const fields: Record<string, string> = {}
  for (const [k, v] of form.entries()) fields[k] = String(v)

  const { body, status } = await handlePaytrCallback(sid, fields)
  return new Response(body, { status })
}
