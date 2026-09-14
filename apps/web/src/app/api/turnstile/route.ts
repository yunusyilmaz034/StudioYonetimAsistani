import { type NextRequest } from 'next/server'

import type { DeviceTelemetry } from '@studio/core'

import { deviceCodeAction, deviceHeartbeatAuth } from '@/server/actions/turnstile'

// The DEVICE's own endpoint: it asks for the next code to put on its screen, every few seconds.
//
// Authenticated by the device's own secret, not by a staff session — a box bolted to a wall has no
// human to log in as, and giving it one would mean the log naming a person for what a machine did.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// FIRMWARE v1.4 ÖLÇÜMÜ (2026-09-14): başlıklarda gelir, cihaz kaydına yazılır. Eski firmware göndermez → null.
// Sayılar aralık dışındaysa `null`: kutunun gönderdiği bir değer, doğrulanmadan kayda girmez.
const sayi = (v: string | null, min: number, max: number): number | null => {
  if (v === null || v.trim() === '') return null
  const n = Number(v)
  return Number.isFinite(n) && n >= min && n <= max ? Math.round(n) : null
}

function olcum(req: NextRequest): DeviceTelemetry | null {
  const fw = req.headers.get('x-fw')
  if (!fw) return null
  return {
    fw: fw.slice(0, 32),
    rssi: sayi(req.headers.get('x-rssi'), -130, 0),
    heap: sayi(req.headers.get('x-heap'), 0, 1_000_000_000),
    uptimeS: sayi(req.headers.get('x-uptime'), 0, 1_000_000_000),
    pulses: sayi(req.headers.get('x-pulses'), 0, 1_000_000_000),
    resetReason: (req.headers.get('x-reset') ?? '').replace(/[^A-Z_]/g, '').slice(0, 24),
  }
}

export async function POST(req: NextRequest) {
  const auth = await deviceHeartbeatAuth(req)
  if (!auth.ok) return Response.json({ ok: false, error: auth.error }, { status: 401 })
  const res = await deviceCodeAction(auth.ctx, auth.deviceId, olcum(req))
  return Response.json(res, { status: res.ok ? 200 : 400 })
}
