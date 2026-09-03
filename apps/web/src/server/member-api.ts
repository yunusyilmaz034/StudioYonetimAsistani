import { NextResponse, type NextRequest } from 'next/server'

import { available, productPrices, DEFAULT_PREFS, FirestoreCatalogRepository, FirestoreMemberRepository, FirestoreSchedulingRepository, requestMemberDeletion, entriesUsed, FirestoreEntitlementRepository, FirestoreFinanceRepository, FirestoreNotificationRepository, money, newOperationId, sell, systemClock, type BranchId, type Entitlement, type FinanceDeps, type MemberId, type NotificationPrefs, type TenantContext } from '@studio/core'
import type { RetailItem, StoredWallet } from '@studio/core/client'

import { loadOccupancyNow } from './fitness-query'
import { adminAuth, adminDb, adminStorage, storageBucketName } from './firebase-admin'
import { memberClaimsToTenantContext, parseMemberClaims } from './member-claims'
import type { MobileBanner, MobileBranding, MobileCampaign, MobileSettings } from './actions/mobile-settings'
import { readWalletView } from './wallet-query'

// The mobile member API's authentication (AD-70). A native app has no `__session` cookie; it sends the
// member's Firebase ID token as a Bearer header. We verify it EXACTLY the way the cookie is verified —
// `verifyIdToken(token, true)` (the `true` re-checks revocation, so an invite/password reset still logs
// the device out) → `parseMemberClaims` → `memberClaimsToTenantContext`. The memberId comes out of the
// verified token, NEVER a request parameter, so the perimeter (D11) is identical to the web portal's.
export interface MemberApiContext {
  readonly ctx: TenantContext
  readonly memberId: MemberId
  /** The Firebase Auth uid — NOT the memberId (member-claims.ts). Only account deletion needs it. */
  readonly uid: string
}

export async function authenticateMember(req: NextRequest): Promise<MemberApiContext | null> {
  const header = (req.headers.get('authorization') ?? '').trim()
  const token = /^Bearer\s+(.+)$/i.exec(header)?.[1]
  if (!token) return null
  try {
    const decoded = await adminAuth().verifyIdToken(token, true)
    const claims = parseMemberClaims(decoded.uid, decoded as unknown as Record<string, unknown>)
    if (!claims) return null
    return { ctx: memberClaimsToTenantContext(claims), memberId: claims.memberId, uid: claims.uid }
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
  const data = snap.data() as Partial<MobileSettings> | undefined
  const legacy = (data?.banner ?? null) as MobileBanner | null
  const list = (data?.banners as MobileBanner[] | undefined) ?? (legacy ? [legacy] : [])
  const banners = list.filter((b) => b?.active)
  const branding = (data?.branding ?? null) as MobileBranding | null
  const campaign = (data?.campaign ?? null) as MobileCampaign | null
  return {
    occupancyLevel: occ.level,
    banner: banners[0] ?? null, // legacy field — an old app build shows the first active banner
    banners,
    branding,
    campaign: campaign?.active && campaign.imageUrl ? campaign : null,
  }
}

// The studio's own contact card (phone / WhatsApp / address / maps) — NOT the member's PII, it is the
// business's public info, edited in Ayarlar → Genel (settings/studio.company). The app has had no
// contact anywhere; this backs the İletişim screen. Empty strings when the owner hasn't filled it in.
export async function memberStudioContact(ctx: TenantContext) {
  const snap = await adminDb().doc(`studios/${ctx.studioId}/settings/studio`).get()
  const c = (snap.get('company') as
    | { displayName?: string; legalName?: string; phone?: string; email?: string; website?: string | null; address?: string; mapsUrl?: string | null }
    | undefined) ?? {}
  return {
    name: c.displayName || c.legalName || '',
    phone: c.phone ?? '',
    email: c.email ?? '',
    website: c.website ?? null,
    address: c.address ?? '',
    mapsUrl: c.mapsUrl ?? null,
  }
}

// ── Profile photo (member's own avatar) ────────────────────────────────────────────────────────
// Stored in private Storage; read only through a server-signed URL (member PII). The avatar is found
// by LISTING the member's avatar folder and taking the newest object — NOT a Firestore `avatarPath`
// field. That field was silently wiped on every member update: the member doc is fully overwritten
// (`tx.set(ref, memberToFirestore(member))`, member-repo.ts) and `avatarPath` isn't part of the domain
// Member, so it vanished — the upload succeeded but the photo never showed.
const AVATAR_TTL_MS = 24 * 60 * 60 * 1000
async function signedUrl(path: string): Promise<string | null> {
  try {
    const [url] = await adminStorage().bucket(storageBucketName()).file(path).getSignedUrl({ action: 'read', expires: Date.now() + AVATAR_TTL_MS })
    return url
  } catch {
    return null
  }
}

export async function memberAvatarUrl(ctx: TenantContext, memberId: MemberId): Promise<string | null> {
  try {
    const prefix = `studios/${ctx.studioId}/members/${memberId}/avatar/`
    const [files] = await adminStorage().bucket(storageBucketName()).getFiles({ prefix })
    if (files.length === 0) return null
    // Object names end with the upload epoch ms, so the lexicographically-largest name is the newest.
    const newest = files.reduce((a, b) => (a.name >= b.name ? a : b))
    return signedUrl(newest.name)
  } catch {
    return null
  }
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
  // No avatarPath pointer — the read side lists the folder. Nothing to be clobbered by a member save.
  return { ok: true as const, value: { avatarUrl: await signedUrl(path) } }
}

// Her ACTIVE subscriptions. Past ones are deliberately not returned (owner, 2026-08-06:
// "aboneliklerimde geçmiş abonelikler gösterilmesin") — an expired package is the studio's
// accounting, not something the member came to read, and a list of what she used to have reads as a
// debt collector's ledger on the screen she opens to check what she has left.
//
// `past` stays in the RESPONSE as an empty array rather than disappearing from the type: an older
// app build that maps over it must keep working, and this ships to phones long before every member
// updates. Filtering here rather than in the client is what makes the rule true on every surface at
// once — data that nothing renders is data that something renders by accident later.
//
// BİR DEMET, İKİ KAYIT, TEK PAKET (owner, 2026-09-03).
//
// Owner iki ekran görüntüsü yan yana koydu: panelde **1 aktif paket**, üyenin telefonunda *"2 aktif
// paketin var"* ve alt alta **aynı adı taşıyan iki kart** — "Hibrit Aylık — 2 Pilates + 1 Fitness",
// biri 8/8 ders, öbürü 4/4 giriş.
//
// İkisi de doğru veriyi okuyordu. Fark, bu uçtaki eksik bir kuraldı: hibrit bir ürün alan üyeye
// alan duvarı yüzünden **bileşen başına bir entitlement** yazılır (bir pilates kredisi, bir fitness
// girişi — aynı belgede toplanamazlar, çünkü kategori duvarı ikisini ayırmak için var). Panel bunu
// bir karta topluyordu; bu uç ise deponun şeklini olduğu gibi dışarı veriyordu.
//
// Üye tek bir paket satın aldı, tek bir fiyat ödedi ve tek bir bitiş tarihi var. Ona iki paket
// göstermek yalnızca çirkin değil, **yanlış**: "2 aktif paketim var" diye hatırlar, biri bitince
// öbürünün sürdüğünü sanar, ve resepsiyona bunu sorar.
//
// Gruplama SUNUCUDA, istemcide değil — bu dosyanın `past: []` kuralıyla aynı sebep: burada yapılan
// bir kural her yüzeyde aynı anda doğru olur, istemcide yapılan yalnızca güncelleyen telefonlarda.
// Panel'in `toCards`'ı ile aynı anahtar kullanılıyor: **hibrit ürünün `productId`'si** (AD-41 —
// "hibrit mi" sorusunun cevabı isimde değil, katalogdadır).
export async function memberSubscriptions(ctx: TenantContext, memberId: MemberId) {
  const [all, products] = await Promise.all([
    new FirestoreEntitlementRepository(adminDb()).listByMember(ctx, memberId),
    new FirestoreCatalogRepository(adminDb()).listProducts(ctx),
  ])
  const bundleProductIds = new Set(products.filter((p) => (p.components?.length ?? 0) > 0).map((p) => p.id as string))

  const component = (e: Entitlement) => ({
    entitlementId: e.id as string,
    category: e.productSnapshot.category,
    remaining: e.credits ? (e.status === 'active' ? available(e.credits) : 0) : null,
    total: e.credits ? e.credits.granted : null,
    fitnessEntry:
      e.productSnapshot.entryAllowance != null
        ? { used: entriesUsed(e.entryLedger), allowance: e.productSnapshot.entryAllowance }
        : null,
  })

  // Bir kart. Kredili bileşen `remaining`/`total`ı, girişli bileşen `fitnessEntry`yi doldurur — yani
  // ESKİ uygulama sürümleri de tek kart görür (eksik ama yanlış değil), yenisi `components`ten tam
  // dökümü çizer. Tarihler ve ad demetin tamamına ait: zaten hepsi aynı.
  const card = (group: readonly Entitlement[]) => {
    // BİRİNCİL, PARAYA BAKMADAN. Panel demetin yüzü olarak en pahalı bileşeni seçer, çünkü panel
    // parayı gösterir. Bu uç para göstermez ve GÖSTERMEMELİDİR (owner, 2026-07-29) — o yüzden burada
    // fiyat bir ölçüt bile değil: kredili bileşen yüzdür, yoksa `id` sırası. İkisi de kesin, yani
    // aynı demet her okumada aynı kartı verir.
    const credit = group.find((e) => e.credits)
    const primary = credit ?? [...group].sort((a, b) => (a.id as string).localeCompare(b.id as string))[0]!
    const entry = group.find((e) => e.productSnapshot.entryAllowance != null)
    return {
      entitlementId: primary.id as string,
      productName: primary.productSnapshot.name,
      category: primary.productSnapshot.category,
      remaining: credit?.credits ? (credit.status === 'active' ? available(credit.credits) : 0) : null,
      total: credit?.credits ? credit.credits.granted : null,
      // Demetin en geç biteni: üyenin "ne zamana kadar geçerli" sorusunun tek dürüst cevabı.
      validUntil: Math.max(...group.map((e) => Number(e.validUntil))),
      // İLERİ TARİHLİ PAKET (3 Eylül): satın alma günü ile geçerlilik günü aynı olmak zorunda değil.
      // HALE'ninki 3 Eylül'de satıldı, 7 Eylül'de başlıyordu; telefon yalnızca "Alındı: 3 Eylül"
      // yazdığı için paket bugün geçerliymiş gibi okunuyordu. Başlangıç da gönderiliyor, ekran
      // gerektiğinde söylesin.
      validFrom: Math.min(...group.map((e) => Number(e.validFrom))),
      purchasedAt: Number(primary.purchasedAt),
      status: primary.status,
      fitnessEntry: entry
        ? { used: entriesUsed(entry.entryLedger), allowance: entry.productSnapshot.entryAllowance! }
        : null,
      // Demetin dökümü. Tek bileşenli (normal) paketlerde de dolu — istemcinin iki ayrı yolu olmasın.
      components: group.map(component),
    }
  }

  const active = all.filter((e) => e.status === 'active')
  const bundles = new Map<string, Entitlement[]>()
  const cards: ReturnType<typeof card>[] = []
  for (const e of active) {
    const pid = e.productSnapshot.productId as string
    if (bundleProductIds.has(pid)) {
      const g = bundles.get(pid) ?? []
      g.push(e)
      bundles.set(pid, g)
    } else {
      cards.push(card([e]))
    }
  }
  for (const g of bundles.values()) cards.push(card(g))

  return { active: cards.sort((a, b) => a.validUntil - b.validUntil), past: [] }
}

/**
 * The app could NOT register for push, and says so.
 *
 * Until 2026-08-25 the app swallowed this in an empty catch. Android push has been broken for
 * months and nothing anywhere knew: the real defect was never that push failed, it was that failing
 * was indistinguishable from a member who simply declined. Recorded on the member so the answer to
 * "is push actually working?" is a query rather than a guess.
 *
 * Deliberately NOT an event: this is a device's current condition, not something that happened to
 * the business. It is overwritten by the next attempt, and cleared by a success.
 */
export async function memberReportPushFailure(
  ctx: TenantContext,
  memberId: MemberId,
  platform: string,
  reason: string,
) {
  await adminDb()
    .doc(`studios/${ctx.studioId}/members/${memberId}`)
    .set({ pushStatus: { ok: false, platform, reason: reason.slice(0, 200), at: Date.now() } }, { merge: true })
  return { ok: true as const }
}

export async function memberRegisterDevice(ctx: TenantContext, memberId: MemberId, token: string, platform: string) {
  if (!token.startsWith('ExponentPushToken')) {
    await memberReportPushFailure(ctx, memberId, platform, 'invalid_token')
    return { ok: false as const, error: { code: 'invalid_token' } }
  }
  const { createHash } = await import('node:crypto')
  const deviceId = createHash('sha256').update(token).digest('hex').slice(0, 24)
  const memberRef = adminDb().doc(`studios/${ctx.studioId}/members/${memberId}`)
  await memberRef.collection('devices').doc(deviceId).set({ token, platform, updatedAt: Date.now() }, { merge: true })
  // A success clears any previous failure, so the field always describes the LAST attempt rather
  // than the worst one ever seen.
  await memberRef.set(
    { notificationPrefs: { push: true }, pushStatus: { ok: true, platform, at: Date.now() } },
    { merge: true },
  )
  return { ok: true as const }
}

// ── STORED-VALUE WALLET (Doc 27) — the member reads her balance/history and buys retail items from it.
//    All Admin-SDK (the wallets collection is server-only). The money goes through the finance `sell`
//    use-case with method 'wallet', so the same I-37 that guards the desk guards the app.
const financeDeps = (): FinanceDeps => ({ repo: new FirestoreFinanceRepository(adminDb()), clock: systemClock, source: 'member_app' })

export function memberStoredWallet(ctx: TenantContext, memberId: MemberId): Promise<StoredWallet> {
  return readWalletView(ctx, memberId)
}

export async function memberStore(ctx: TenantContext): Promise<readonly RetailItem[]> {
  const snap = await adminDb().collection(`studios/${ctx.studioId}/retailProducts`).get()
  return snap.docs
    .map((d) => {
      const x = d.data()
      return {
        id: d.id,
        name: String(x.name ?? 'Ürün'),
        priceInKurus: Number(x.priceInKurus ?? 0),
        category: String(x.category ?? ''),
        stock: x.trackStock === true ? Number(x.stock ?? 0) : null,
        active: x.active !== false,
      }
    })
    .filter((p) => p.active)
    .sort((a, b) => a.name.localeCompare(b.name, 'tr'))
    .map((p) => ({ id: p.id, name: p.name, priceInKurus: p.priceInKurus, category: p.category, stock: p.stock }))
}

export async function memberBuyFromWallet(ctx: TenantContext, memberId: MemberId, productId: string, quantity: number) {
  const db = adminDb()
  const qty = Math.max(1, Math.floor(quantity || 1))
  const ref = db.doc(`studios/${ctx.studioId}/retailProducts/${productId}`)

  // Decrement stock first (no oversell), then take the money. If the wallet is short, put stock back.
  let line: { productId: null; description: string; quantity: number; unitPrice: ReturnType<typeof money>; entitlementId: null; giftCardId: null } | null = null
  let total = 0
  let tracked = false
  try {
    const built = await db.runTransaction(async (tx) => {
      const doc = await tx.get(ref)
      if (!doc.exists) throw new Error('not_found')
      const x = doc.data()!
      if (x.active === false) throw new Error('not_found')
      const price = Number(x.priceInKurus ?? 0)
      if (x.trackStock === true) {
        const stock = Number(x.stock ?? 0)
        if (stock < qty) throw new Error('out_of_stock')
        tx.set(ref, { stock: stock - qty, updatedAt: Date.now() }, { merge: true })
      }
      return { price, name: String(x.name ?? 'Ürün'), tracked: x.trackStock === true }
    })
    total = built.price * qty
    tracked = built.tracked
    line = { productId: null, description: built.name, quantity: qty, unitPrice: money(built.price), entitlementId: null, giftCardId: null }
  } catch (e) {
    const msg = e instanceof Error ? e.message : ''
    if (msg === 'out_of_stock') return { ok: false as const, error: { code: 'retail_out_of_stock' as const, available: 0 } }
    return { ok: false as const, error: { code: 'product_not_found' as const } }
  }

  const suffix = newOperationId().slice(4)
  const result = await sell(financeDeps(), ctx, {
    saleId: `sal_${suffix}`,
    memberId,
    branchId: (ctx.branchIds[0] ?? null) as BranchId,
    lines: [line],
    discounts: [],
    discountCeilingPercent: null,
    payment: {
      paymentId: `pay_${suffix}`,
      allocationId: `alc_${suffix}`,
      amount: money(total),
      method: 'wallet',
      receivedAt: systemClock.now(),
      drawerId: null,
      giftCardCode: null,
      note: 'Cüzdan alışverişi',
    },
  })

  if (!result.ok && tracked) {
    await db.runTransaction(async (tx) => {
      const s = await tx.get(ref)
      if (s.exists) tx.set(ref, { stock: Number(s.data()!.stock ?? 0) + qty, updatedAt: Date.now() }, { merge: true })
    })
  }
  if (!result.ok) return { ok: false as const, error: result.error }
  return { ok: true as const, value: await readWalletView(ctx, memberId) }
}


// ── "Hesabımı sil" (App Store 5.1.1(v), 2026-07-27) ──────────────────────────────────────────
//
// Two things happen, and the ORDER is the design:
//
//   1. Her LOGIN IS DESTROYED. This is what makes it a deletion from where she stands — she is
//      signed out of every device within the minute and cannot sign back in. It happens FIRST and
//      unconditionally, including when she is asking a second time, because that is the part she can
//      verify and the part that must never silently fail to happen.
//   2. The request is RECORDED so the studio completes the erasure.
//
// What deliberately does NOT happen: her data is not destroyed here. Her payments and invoices are
// the STUDIO's business records under a statutory retention period (AD-67 keeps erasure break-glass
// for exactly this reason), and a member must not be able to put the studio in breach of tax law
// from a phone. Apple's guideline requires the deletion to be INITIATED in the app and explicitly
// permits keeping what law requires — both halves hold.
export async function deleteMemberAccount(
  ctx: TenantContext,
  memberId: MemberId,
  uid: string,
  source: 'member_app' | 'member_portal',
): Promise<{ ok: true; value: { deleted: true } }> {
  const repo = new FirestoreMemberRepository(adminDb())

  // 1 · End the session everywhere, then remove the login itself. Revoking FIRST means that even if
  // the delete below fails, no existing token survives — the weaker outcome is still "logged out".
  // The uid comes from the VERIFIED token, so this can only ever delete the caller's own login.
  try {
    await adminAuth().revokeRefreshTokens(uid)
    await adminAuth().deleteUser(uid)
  } catch {
    // Already gone (she asked twice, or it was removed by hand). Nothing to undo, and it must not
    // stop the request being recorded.
  }

  // 2 · Record it. Idempotent in the domain: asking twice is one request, not two acts.
  await requestMemberDeletion(
    { repo, clock: systemClock },
    ctx,
    { memberId, source },
  )
  return { ok: true, value: { deleted: true } }
}


// ── What a member may buy from inside the app (2026-07-27) ──────────────────────────────────
//
// Gated by `memberSellable`, which is NOT the public page's `onlineSellable` (owner, 2026-07-27).
// They answer different questions and a studio will want them to differ: one shows a price to a
// stranger, this one offers a renewal to somebody who is already a member. An intro offer belongs in
// the first and not the second; a renewal-only package is the reverse. PT is in neither — booking a
// trainer's hour is a conversation.
//
// `totalKurus` is what she will actually be charged: base + the studio's card surcharge, because
// paying in the app IS paying by card. `cashKurus` rides along so the screen can be honest about
// why the number differs from the one on the wall.
export interface MemberBuyableProduct {
  readonly id: string
  readonly name: string
  readonly category: string
  readonly durationDays: number
  readonly totalKurus: number
  readonly cashKurus: number
}

export async function memberBuyableProducts(ctx: TenantContext): Promise<readonly MemberBuyableProduct[]> {
  const db = adminDb()
  const [products, settings] = await Promise.all([
    new FirestoreCatalogRepository(db).listProducts(ctx),
    new FirestoreSchedulingRepository(db).getStudioSettings(ctx),
  ])
  return products
    .filter((p) => p.active && p.memberSellable)
    .map((p) => ({
      id: p.id as string,
      name: p.name,
      category: p.category as string,
      durationDays: p.durationDays,
      // `priceInKurus` is the CARD price — buying in the app IS buying by card. The per-category
      // surcharge still applies for studios that price that way; it is 0 where a product carries its
      // own cash price, because then the two numbers are set independently and adding a rule on top
      // would invent a third.
      totalKurus: productPrices(p, settings?.paymentSurcharge).cardKurus,
      // Equal ⇒ one price, and the screen shows a single number as it always has.
      cashKurus: productPrices(p, settings?.paymentSurcharge).cashKurus,
    }))
    .sort((a, b) => a.totalKurus - b.totalKurus)
}
