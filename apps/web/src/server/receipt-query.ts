import {
  available,
  FirestoreEntitlementRepository,
  FirestoreFinanceRepository,
  moneyByEntitlement,
  systemClock,
  FirestoreMemberRepository,
  FirestoreSchedulingRepository,
  type EntitlementId,
  type MemberId,
  type TenantContext,
} from '@studio/core'

import { adminDb } from './firebase-admin'

// THE RECEIPT (v1.27 S3 · owner, 2026-07-13).
//
// **It is not a fiscal document, and it says so — in large type, at the bottom.** It is what reception
// hands a member who has just paid: *what did I buy, what did I pay, what do I have left, and until
// when?* Four questions that a member currently has to take somebody's word for.
//
// ── The company details come from ONE place ─────────────────────────────────────────────────
// `/settings/studio` (v1.27 S2). A studio name typed into a receipt template is a studio name that
// will be wrong in one of them — and the one it is wrong in is the one in a member's hand.

import type { ReceiptData, ReceiptKind } from '@/lib/receipt'

/**
 * A studio that has not filled in its settings yet still gets a receipt — with the fields it has.
 * The alternative is refusing to print one, and reception would simply write it by hand.
 */
export async function loadReceipt(
  ctx: TenantContext,
  kind: ReceiptKind,
  entitlementId: EntitlementId,
  issuedAt: number,
): Promise<ReceiptData | null> {
  const db = adminDb()

  const [ent, settings] = await Promise.all([
    new FirestoreEntitlementRepository(db).getEntitlement(ctx, entitlementId),
    new FirestoreSchedulingRepository(db).getStudioSettings(ctx),
  ])
  // The money on the slip comes from the LEDGER (Alpha Review). A receipt that says "Ödenen: 3.000 ₺"
  // while the till has no record of it is a receipt that will be waved at reception in a month.
  if (!ent) return null

  const ledger = await moneyByEntitlement(
    { repo: new FirestoreFinanceRepository(db), clock: systemClock },
    ctx,
    ent.memberId,
  )
  const paid = ledger.get(entitlementId as string) ?? null

  const member = await new FirestoreMemberRepository(db).findById(ctx, ent.memberId as MemberId)
  const company = settings?.company ?? null

  const credits = ent.credits
  const grant = ent.productSnapshot.grant

  return {
    kind,
    issuedAt,
    company: {
      // The name a MEMBER knows the studio by, not the one on the tax certificate.
      displayName: company?.displayName || company?.legalName || 'Stüdyo',
      legalName: company?.legalName ?? null,
      phone: company?.phone || null,
      email: company?.email || null,
      address: company?.address || null,
      website: company?.website || null,
    },
    memberName: member?.fullName ?? '—',
    productName: ent.productSnapshot.name,
    durationDays: grant.kind === 'credits' ? grant.validForDays : grant.durationDays,
    validFrom: ent.validFrom as number,
    validUntil: ent.validUntil as number,
    creditsGranted: credits ? credits.granted : null,
    // What a class actually took. NOT `granted − available`: that would count a credit merely HELD
    // by an upcoming booking as spent, and hand the member a receipt saying she has one fewer class
    // than she does.
    creditsUsed: credits ? credits.consumed : null,
    creditsRemaining: credits ? available(credits) : null,
    method: paid?.method ?? null,
    paidKurus: paid?.paid.amount ?? 0,
    priceKurus: ent.priceAgreed.amount,
    balanceKurus: paid?.due.amount ?? ent.priceAgreed.amount,
    note: null,
  }
}
