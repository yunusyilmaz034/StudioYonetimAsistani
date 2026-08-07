'use server'

import { createHash, randomInt } from 'node:crypto'
import { type NextRequest } from 'next/server'
import { z } from 'zod'

import {
  crossTurnstile,
  FirestoreCheckinRepository,
  issueTurnstileCode,
  openTurnstileManually,
  systemClock,
  type CheckinDeps,
  type DeviceId,
  type MemberId,
  type TenantContext,
} from '@studio/core'

import { adminDb } from '../firebase-admin'
import { requireTenantContext } from '../auth'

// ── TURNSTILE (v1.33) ────────────────────────────────────────────────────────────────────────
//
// Three callers, three different kinds of principal, and they must not be able to impersonate each
// other:
//
//   · the DEVICE asks for the next code — authenticated by its own secret (`deviceHeartbeatAuth`)
//   · the MEMBER asks to cross — authenticated by her member token, via `withMember`
//   · RECEPTION opens the arm by hand — authenticated by a staff session
//
// The device's secret is compared as a HASH. Storing it in the clear would mean anyone who can read
// the database can open the door, and the database is read by more people than the door should be.

const deps = (): CheckinDeps => ({ repo: new FirestoreCheckinRepository(adminDb()), clock: systemClock })
const OPS = ['owner', 'receptionist', 'platform_admin'] as const
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')

/**
 * Authenticate the device from its `Authorization: Bearer <deviceId>.<secret>` header.
 *
 * Deliberately NOT a staff login. A box on a wall has no human to log in as, and lending it one
 * would make the log name a person for what a machine did (#5) — the check-in it produces carries
 * `actor: { type: 'device' }` precisely so nobody has to guess later.
 */
export async function deviceHeartbeatAuth(
  req: NextRequest,
): Promise<{ ok: true; ctx: TenantContext; deviceId: DeviceId } | { ok: false; error: { code: string } }> {
  const raw = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? ''
  const studioId = req.headers.get('x-studio-id') ?? ''
  const [deviceId, secret] = raw.split('.')
  if (!deviceId || !secret || !studioId) return { ok: false, error: { code: 'qr_invalid' } }

  const snap = await adminDb().doc(`studios/${studioId}/devices/${deviceId}`).get()
  const d = snap.data()
  // ONE error for every failure — unknown device, wrong secret, deactivated. A box probing the
  // endpoint must not learn which of the three it got wrong.
  if (!d || d.active !== true || d.secretHash !== sha256(secret)) return { ok: false, error: { code: 'qr_invalid' } }

  return {
    ok: true,
    deviceId: deviceId as DeviceId,
    ctx: {
      studioId: studioId as never,
      branchIds: [d.branchId as never],
      role: 'kiosk',
      actor: { type: 'device', id: deviceId as DeviceId },
    } as TenantContext,
  }
}

/** The next six digits for the screen. `randomInt` is the crypto one — a guessable door is no door. */
export async function deviceCodeAction(ctx: TenantContext, deviceId: DeviceId) {
  const digits = String(randomInt(0, 1_000_000)).padStart(6, '0')
  return issueTurnstileCode(deps(), ctx, deviceId, digits)
}

/**
 * The member scanned the screen.
 *
 * `direction` comes from the DEVICE via the app only when the arm's direction wire is connected; it
 * is optional and untrusted-but-harmless — the worst a wrong value does is record a crossing the
 * wrong way round, which the nightly sweep and the next real crossing both correct. It can never
 * open a door that the code itself did not already open.
 */
export async function crossOwnTurnstile(ctx: TenantContext, memberId: MemberId, input: unknown) {
  const p = z
    .object({
      code: z.string().trim().min(4).max(32),
      direction: z.enum(['in', 'out']).nullable().optional(),
    })
    .parse(input)
  return crossTurnstile(deps(), ctx, {
    memberId,
    code: p.code,
    reportedDirection: p.direction ?? null,
  })
}

/** Reception opens the arm for a guest. Records WHO opened it, and nothing about a member. */
export async function openTurnstileAction(input: unknown) {
  const p = z.object({ deviceId: z.string().min(1), reason: z.string().trim().min(1).max(200) }).parse(input)
  const ctx = await requireTenantContext(OPS)
  return openTurnstileManually(deps(), ctx, p.deviceId as DeviceId, p.reason)
}

/** The panel's device list — name, branch, and whether the door has spoken to us lately. */
export async function listTurnstilesAction() {
  const ctx = await requireTenantContext(OPS)
  const devices = await deps().repo.listDevices(ctx)
  return devices.map((d) => ({
    id: d.id as string,
    name: d.name,
    branchId: d.branchId as string,
    active: d.active,
    lastSeenAt: d.lastSeenAt === null ? null : Number(d.lastSeenAt),
  }))
}
