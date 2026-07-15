import type { NextRequest } from 'next/server'

import { handlePaytrCallback } from '@/server/actions/payments'

// ── PAYTR server-to-server callback (Plus Phase 6, §9). ──────────────────────────────────────
//
// The ONLY thing that grants a package — NOT the browser return URL (a card can decline after the
// redirect). All the guards live in the server function: hash verification, tenant (?sid) match,
// provider-reference match, amount check, and idempotency (the intent's own status — a replayed
// callback grants nothing). On success we respond exactly "OK", or PAYTR retries. This route is
// UNAUTHENTICATED because PAYTR is the caller — which is why the hash IS the authentication.

export async function POST(req: NextRequest): Promise<Response> {
  const sid = req.nextUrl.searchParams.get('sid')
  if (!sid) return new Response('MISSING_SID', { status: 400 })

  const form = await req.formData().catch(() => null)
  if (!form) return new Response('BAD_REQUEST', { status: 400 })
  const fields: Record<string, string> = {}
  for (const [k, v] of form.entries()) fields[k] = String(v)

  const { body, status } = await handlePaytrCallback(sid, fields)
  return new Response(body, { status })
}
