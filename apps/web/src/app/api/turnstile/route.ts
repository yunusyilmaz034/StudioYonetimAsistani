import { type NextRequest } from 'next/server'

import { deviceCodeAction, deviceHeartbeatAuth } from '@/server/actions/turnstile'

// The DEVICE's own endpoint: it asks for the next code to put on its screen, every few seconds.
//
// Authenticated by the device's own secret, not by a staff session — a box bolted to a wall has no
// human to log in as, and giving it one would mean the log naming a person for what a machine did.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const auth = await deviceHeartbeatAuth(req)
  if (!auth.ok) return Response.json({ ok: false, error: auth.error }, { status: 401 })
  const res = await deviceCodeAction(auth.ctx, auth.deviceId)
  return Response.json(res, { status: res.ok ? 200 : 400 })
}
