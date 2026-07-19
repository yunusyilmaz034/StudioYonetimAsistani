import { NextResponse, type NextRequest } from 'next/server'

import { available, DEFAULT_PREFS, FirestoreEntitlementRepository, FirestoreNotificationRepository, type Entitlement, type MemberId, type NotificationPrefs, type TenantContext } from '@studio/core'

import { loadOccupancyNow } from './fitness-query'
import { adminAuth, adminDb, adminStorage, storageBucketName } from './firebase-admin'
import { memberClaimsToTenantContext, parseMemberClaims } from './member-claims'
import type { MobileBanner, MobileBranding, MobileSettings } from './actions/mobile-settings'

// The mobile member API's authentication (AD-70). A native app has no `__session` cookie; it sends the
// member's Firebase ID token as a Bearer header. We verify it EXACTLY the way the cookie is verified —
// `verifyIdToken(token, true)` (the `true` re-checks revocation, so an invite/password reset still logs
// the device out) → `parseMemberClaims` → `memberClaimsToTenantContext`. The memberId comes out of the
// verified token, NEVER a request parameter, so the perimeter (D11) is identical to the web portal's.
export interface MemberApiContext {
  readonly ctx: TenantContext
  readonly memberId: MemberId
}

export async function authenticateMember(req: NextRequest): Promise<MemberApiContext | null> {
  const header = (req.headers.get('authorization') ?? '').trim()
  const token = /^Bearer\s+(.+)$/i.exec(header)?.[1]
  if (!token) return null
  try {
    const decoded = await adminAuth().verifyIdToken(token, true)
    const claims = parseMemberClaims(decoded.uid, decoded as unknown as Record<string, unknown>)
    if (!claims) return null
    return { ctx: memberClaimsToTenantContext(claims), memberId: claims.memberId }
  } catch {
    return null
  }
}

// The single wrapper every authenticated member route uses: verify the Bearer token, hand the handler a
// trusted `{ ctx, memberId }`, and turn the result into JSON. A thrown error becomes a 500 with a code —
// never a stack trace to the client.
export async function withMember(
  req: NextRequest,
  fn: (ctx: TenantContext, memberId: MemberId) => Promise<unknown>,
): Promise<NextResponse> {
  const auth = await authenticateMember(req)
  if (!auth) return NextResponse.json({ ok: false, error: { code: 'unauthorized' } }, { status: 401 })
  try {
    const data = await fn(auth.ctx, auth.memberId)
    return NextResponse.json(data ?? { ok: true })
  } catch (err) {
    console.error('[member-api]', (err as Error)?.message ?? err)
    return NextResponse.json({ ok: false, error: { code: 'internal' } }, { status: 500 })
  }
}

// ── Firestore-touching reads/writes, kept HERE (src/server) so the route handlers never import
//    firebase-admin directly (Doc 3 §8, enforced by dependency-cruiser). ─────────────────────────
export function memberInboxList(ctx: TenantContext, memberId: MemberId) {
  return new FirestoreNotificationRepository(adminDb()).listInbox(ctx, memberId as string)
}

export async function memberInboxMarkRead(ctx: TenantContext, memberId: MemberId, intentId: string) {
  await new FirestoreNotificationRepository(adminDb()).markInboxRead(ctx, memberId as string, intentId)
  return { ok: true as const }
}

export async function memberPrefsGet(ctx: TenantContext, memberId: MemberId): Promise<NotificationPrefs> {
  const snap = await adminDb().doc(`studios/${ctx.studioId}/members/${memberId}`).get()
  return { ...DEFAULT_PREFS, ...((snap.get('notificationPrefs') as NotificationPrefs) ?? {}) }
}

export async function memberPrefsSet(ctx: TenantContext, memberId: MemberId, prefs: NotificationPrefs) {
  await adminDb().doc(`studios/${ctx.studioId}/members/${memberId}`).set({ notificationPrefs: prefs }, { merge: true })
  return { ok: true as const }
}

// M2 — register (or refresh) a device's Expo push token. Idempotent by a hash of the token; the raw
// token lives ONLY in this server-only subcollection (rules deny client reads). Registering a device
// flips `prefs.push` on so she starts receiving push — she can turn it back off from Profil.
// Home-screen extras: anonymous occupancy level + the owner's active campaign banner.
export async function memberHomeExtras(ctx: TenantContext) {
  const [occ, snap] = await Promise.all([
    loadOccupancyNow(ctx),
    adminDb().doc(`studios/${ctx.studioId}/settings/mobile`).get(),
  ])
  const data = snap.data() as MobileSettings | undefined
  const banner = (data?.banner ?? null) as MobileBanner | null
  const branding = (data?.branding ?? null) as MobileBranding | null
  return { occupancyLevel: occ.level, banner: banner?.active ? banner : null, branding }
}

// ── Profile photo (member's own avatar) ────────────────────────────────────────────────────────
// Stored in private Storage; read only through a short-lived server-signed URL (member PII). The
// pointer is written directly to the member doc, the same way notificationPrefs already are.
const AVATAR_TTL_MS = 60 * 60 * 1000
async function signedUrl(path: string): Promise<string | null> {
  try {
    const [url] = await adminStorage().bucket(storageBucketName()).file(path).getSignedUrl({ action: 'read', expires: Date.now() + AVATAR_TTL_MS })
    return url
  } catch {
    return null
  }
}

export async function memberAvatarUrl(ctx: TenantContext, memberId: MemberId): Promise<string | null> {
  const snap = await adminDb().doc(`studios/${ctx.studioId}/members/${memberId}`).get()
  const path = snap.get('avatarPath') as string | undefined
  return path ? signedUrl(path) : null
}

export async function memberUploadPhoto(ctx: TenantContext, memberId: MemberId, dataUrl: string) {
  const m = /^data:(image\/\w+);base64,(.+)$/s.exec(dataUrl)
  const mime = m?.[1]
  const b64 = m?.[2]
  if (!mime || !b64) return { ok: false as const, error: { code: 'invalid_image' } }
  const buf = Buffer.from(b64, 'base64')
  if (buf.length > 4_000_000) return { ok: false as const, error: { code: 'image_too_large' } }
  const path = `studios/${ctx.studioId}/members/${memberId}/avatar/${Date.now()}.jpg`
  await adminStorage().bucket(storageBucketName()).file(path).save(buf, { contentType: mime, resumable: false })
  await adminDb().doc(`studios/${ctx.studioId}/members/${memberId}`).set({ avatarPath: path }, { merge: true })
  return { ok: true as const, value: { avatarUrl: await signedUrl(path) } }
}

// All of her subscriptions — active and past — for the subscriptions detail screen.
export async function memberSubscriptions(ctx: TenantContext, memberId: MemberId) {
  const all = await new FirestoreEntitlementRepository(adminDb()).listByMember(ctx, memberId)
  const map = (e: Entitlement) => ({
    entitlementId: e.id as string,
    productName: e.productSnapshot.name,
    category: e.productSnapshot.category,
    remaining: e.credits ? available(e.credits) : null,
    total: e.credits ? e.credits.granted : null,
    validUntil: Number(e.validUntil),
    purchasedAt: Number(e.purchasedAt),
    status: e.status,
  })
  const active = all.filter((e) => e.status === 'active').map(map).sort((a, b) => a.validUntil - b.validUntil)
  const past = all.filter((e) => e.status !== 'active').map(map).sort((a, b) => b.purchasedAt - a.purchasedAt)
  return { active, past }
}

export async function memberRegisterDevice(ctx: TenantContext, memberId: MemberId, token: string, platform: string) {
  if (!token.startsWith('ExponentPushToken')) return { ok: false as const, error: { code: 'invalid_token' } }
  const { createHash } = await import('node:crypto')
  const deviceId = createHash('sha256').update(token).digest('hex').slice(0, 24)
  const memberRef = adminDb().doc(`studios/${ctx.studioId}/members/${memberId}`)
  await memberRef.collection('devices').doc(deviceId).set({ token, platform, updatedAt: Date.now() }, { merge: true })
  await memberRef.set({ notificationPrefs: { push: true } }, { merge: true })
  return { ok: true as const }
}
