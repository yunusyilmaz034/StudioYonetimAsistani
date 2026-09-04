// ── ONLINE SATIŞ: turning a paid public purchase into a membership (owner, 2026-08-05). ──────
//
// A PLAIN server module, deliberately NOT `'use server'` — the same reasoning as `payment-callback`:
// these functions grant packages, and every export of a `'use server'` file is a public POST endpoint.
// The guard lives in the Server Action that calls this.
//
// The shape of the operation: someone the studio has never met paid on the public page. The callback
// recorded the money and stopped. Here reception says WHO she is — a member already on the books, or
// a new one — and only then is the package granted, the payment attached, and the invite sent.
//
// Everything about this is one-way, so all three refusals matter more than the happy path: money that
// has not arrived, a purchase already turned into a membership, and a buyer nobody has chosen.

import {
  decideFulfilIntent,
  FirestoreCatalogRepository,
  FirestoreMemberRepository,
  FirestorePaymentIntentRepository,
  newCorrelationId,
  normalizePhone,
  registerMember,
  systemClock,
  type BranchId,
  type DomainError,
  type MemberId,
  type MembersDeps,
  type PaymentIntent,
  type ProductId,
  type Result,
  type TenantContext,
} from '@studio/core'

import { adminDb } from './firebase-admin'
import { grantIntentPackage, issueInviteFor } from './payment-callback'

const intentRepo = () => new FirestorePaymentIntentRepository(adminDb())
const membersDeps = (): MembersDeps => ({ repo: new FirestoreMemberRepository(adminDb()), clock: systemClock, source: 'reception_web' })
const dctx = (ctx: TenantContext) => ({
  studioId: ctx.studioId,
  actor: ctx.actor,
  now: systemClock.now(),
  correlationId: newCorrelationId(),
  source: 'reception_web' as const,
})

// One row of the "money in, nothing delivered" list. The buyer's details come off the intent's own
// context — state, never an event (#6) — because until reception acts there is no member to read them
// from. `existingMemberId` is the phone match: a SUGGESTION for a human, never an automatic merge
// (AD-40 — a collision is reported).

/** E.164 → benzersizlik anahtarı, sonra ara. Normalleşmeyen bir numara eşleşme ÜRETMEZ, uydurmaz. */
async function membersByKey(
  members: { findByPhone: (ctx: TenantContext, key: string) => Promise<{ id: unknown; fullName: string } | null> },
  ctx: TenantContext,
  phone: string,
) {
  const norm = normalizePhone(phone)
  if (!norm.ok) return null
  return members.findByPhone(ctx, norm.value.normalized)
}

export interface PendingOnlineSale {
  readonly intentId: string
  readonly buyerName: string
  readonly buyerPhone: string
  readonly buyerEmail: string | null
  readonly productId: string
  readonly productName: string
  readonly amountKurus: number
  readonly paidAt: number
  readonly validFrom: string
  readonly validUntil: string | null
  readonly existingMemberId: string | null
  readonly existingMemberName: string | null
}

export async function listPendingOnlineSales(ctx: TenantContext): Promise<readonly PendingOnlineSale[]> {
  const intents = await intentRepo().listUnfulfilled(ctx, 'public_membership')
  if (intents.length === 0) return []

  const catalog = new FirestoreCatalogRepository(adminDb())
  const members = new FirestoreMemberRepository(adminDb())

  return Promise.all(
    intents.map(async (i) => {
      const phone = i.context.buyerPhone ?? ''
      const [product, existing] = await Promise.all([
        i.context.productId ? catalog.getProduct(ctx, i.context.productId as ProductId) : Promise.resolve(null),
        // TELEFON, BENZERSİZLİK ANAHTARINA ÇEVRİLEREK ARANIR (2026-09-04).
        //
        // `context.buyerPhone` E.164'tür ("+905380895488"); `findByPhone` ise rakam-only anahtarı
        // bekler ("905380895488"). Aradaki artı yüzünden arama HİÇBİR ZAMAN eşleşmiyordu ve ekran
        // her seferinde yalnızca "Yeni üye oluştur" öneriyordu — yani zaten kayıtlı bir üye için tek
        // tık ikinci bir üye, ikinci bir paket ve ikinci kez sayılan bir tahsilat demekti.
        //
        // 4 Eylül'de ramak kaldı: Elif Atalay Öztürk 18:43'te resepsiyonca kaydedilmişti, 18:49'da
        // online ödemesi düştü, ve pano onu tanımadığı için "yeni üye" dedi.
        phone ? membersByKey(members, ctx, phone) : Promise.resolve(null),
      ])
      return {
        intentId: i.id,
        buyerName: i.context.buyerName ?? 'Bilinmeyen',
        buyerPhone: phone,
        buyerEmail: i.context.buyerEmail ?? null,
        productId: (i.context.productId as string | undefined) ?? '',
        productName: product?.name ?? 'Bilinmeyen paket',
        amountKurus: i.amount.amount,
        paidAt: i.updatedAt as unknown as number,
        validFrom: i.context.validFrom ?? '',
        validUntil: i.context.validUntil ?? null,
        existingMemberId: existing ? (existing.id as string) : null,
        existingMemberName: existing?.fullName ?? null,
      }
    }),
  )
}

// Reception's decision, in one transaction-ish sequence: resolve the member, grant, mark fulfilled.
//
// `memberId` present ⇒ attach to that member (she was already on the books, or reception picked her).
// `memberId` absent  ⇒ create a new member from the buyer's own details and invite her.
//
// ORDER MATTERS. The grant runs BEFORE the intent is marked fulfilled, so a crash in between leaves
// the purchase on the pending list — visible, repeatable, and refused by `decideFulfilIntent` only
// once it has genuinely completed. The opposite order would hide a purchase that never got a package.
export async function fulfilOnlineSale(
  ctx: TenantContext,
  args: { intentId: string; memberId?: string | null },
): Promise<Result<{ memberId: string; created: boolean }, DomainError>> {
  const intent = await intentRepo().getIntent(ctx, args.intentId)
  if (!intent) return { ok: false, error: { code: 'online_sale_not_found' } }
  if (intent.purpose !== 'public_membership') return { ok: false, error: { code: 'online_sale_not_found' } }
  if (intent.status !== 'paid') return { ok: false, error: { code: 'payment_not_paid' } }
  if (intent.fulfilledAt) return { ok: false, error: { code: 'payment_already_fulfilled' } }

  const product = intent.context.productId
    ? await new FirestoreCatalogRepository(adminDb()).getProduct(ctx, intent.context.productId as ProductId)
    : null
  if (!product) return { ok: false, error: { code: 'online_sale_not_found' } }

  const resolved = await resolveMember(ctx, intent, args.memberId ?? null)
  if (!resolved.ok) return resolved

  await grantIntentPackage(ctx, intent, resolved.value.memberId, product)

  // The consents follow the member, not the transaction. They were recorded on the intent at the
  // moment she ticked them (with the version of each text she saw); the intent is the proof, but
  // nobody looking at a member's file two years from now will think to go looking for a payment
  // intent. Copied here, best-effort and after the package is safely granted — a consent write that
  // failed must never be the reason a paid-for membership does not exist.
  await recordConsents(ctx, resolved.value.memberId, intent).catch(() => {})

  const decided = decideFulfilIntent(dctx(ctx), intent, resolved.value.memberId, !resolved.value.created)
  if (!decided.ok) return decided
  await intentRepo().saveIntent(ctx, decided.value.next, decided.value.events)

  // A brand-new member has no account yet — mint her portal invite so she can set a password. Last,
  // and best-effort inside its own helper: a failed message must never undo a granted package.
  if (resolved.value.created) await issueInviteFor(ctx, resolved.value.memberId, intent.id)

  return { ok: true, value: resolved.value }
}

async function resolveMember(
  ctx: TenantContext,
  intent: PaymentIntent,
  chosen: string | null,
): Promise<Result<{ memberId: string; created: boolean }, DomainError>> {
  if (chosen && chosen.trim()) {
    const member = await new FirestoreMemberRepository(adminDb()).findById(ctx, chosen.trim() as MemberId)
    if (!member) return { ok: false, error: { code: 'online_sale_not_found' } }
    return { ok: true, value: { memberId: member.id as string, created: false } }
  }

  const reg = await registerMember(membersDeps(), ctx, {
    fullName: (intent.context.buyerName ?? '').trim() || 'Üye',
    phone: intent.context.buyerPhone ?? '',
    homeBranchId: (ctx.branchIds[0] ?? null) as BranchId | null,
    email: intent.context.buyerEmail ?? null,
    birthDate: null,
    notes: 'Online üyelik satışı',
    emergencyContact: null,
  })
  if (reg.ok) return { ok: true, value: { memberId: reg.value.memberId as string, created: true } }
  // The phone was taken between the list being drawn and the button being pressed. Attach to the
  // member who owns it rather than refusing — that is the same answer reception would have given, and
  // AD-40 forbids inventing a second record for one phone.
  if (reg.error.code === 'phone_already_registered') {
    return { ok: true, value: { memberId: (reg.error as { memberId: string }).memberId, created: false } }
  }
  return { ok: false, error: reg.error }
}

// ── HUKUKİ ONAY KAYDI ────────────────────────────────────────────────────────────────────────
//
// Written onto the member document as `legalConsents`, keyed by document. Keyed rather than appended
// so the CURRENT state of a consent is one read and cannot be ambiguous; the append-only history of
// how it got there is the intent chain and the event log, which is where history belongs.
//
// The marketing consent is different in kind from the others: it is not a record of something she
// read, it is a switch that decides whether a message may be sent. So it also flips
// `notificationPrefs.campaign`, which is the flag the notification domain actually consults — a
// consent stored where nothing reads it is a consent that does nothing.
async function recordConsents(ctx: TenantContext, memberId: string, intent: PaymentIntent): Promise<void> {
  const consents = intent.context.consents ?? []
  if (consents.length === 0) return

  const legalConsents: Record<string, { version: string; acceptedAt: string; source: string; intentId: string }> = {}
  for (const c of consents) {
    legalConsents[c.key] = { version: c.version, acceptedAt: c.acceptedAt, source: 'online_checkout', intentId: intent.id }
  }
  const marketing = consents.some((c) => c.key === 'marketing')

  await adminDb()
    .doc(`studios/${ctx.studioId}/members/${memberId}`)
    .set(
      {
        legalConsents,
        // Merge, never replace: she may already have preferences, and a whole-object write here would
        // silently reset the channels she chose.
        ...(marketing ? { notificationPrefs: { campaign: true } } : {}),
      },
      { merge: true },
    )
}
