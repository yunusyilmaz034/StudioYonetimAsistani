import { type NextRequest } from 'next/server'

import { deviceCrossingAction, deviceHeartbeatAuth } from '@/server/actions/turnstile'

// "Has the code I am showing been used?" — the screen's own poll, a couple of times a second-ish.
//
// Separate from the code endpoint on purpose. Minting a code on every poll would leave dozens of
// live codes floating around a public screen at once; a code is asked for when the current one is
// nearly spent, and this is asked for constantly. Two rhythms, two endpoints.
//
// Same device secret, same reason as `/api/turnstile`: a box on a wall has no human to log in as.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const auth = await deviceHeartbeatAuth(req)
  if (!auth.ok) return Response.json({ ok: false, error: auth.error }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as { code?: unknown }
  const code = typeof body.code === 'string' ? body.code.trim() : ''
  if (!/^\d{6}$/.test(code)) return Response.json({ ok: true, value: { crossed: null } })

  const res = await deviceCrossingAction(auth.ctx, auth.deviceId, code)
  return Response.json(res, { status: 200 })
}
