import 'server-only'

import {
  FirestoreEntitlementRepository,
  FirestoreImportBatchRepository,
  FirestoreMemberRepository,
  money,
  systemClock,
  type ImportModuleDeps,
  type ImportProduct,
  type ProductId,
  type TenantContext,
} from '@studio/core'

import { adminDb } from '../firebase-admin'

// Wiring only. The use-case lives in `core` — this hands it the Firestore repositories.
export function importDeps(): ImportModuleDeps {
  return {
    batches: new FirestoreImportBatchRepository(adminDb()),
    clock: systemClock,
    members: {
      repo: new FirestoreMemberRepository(adminDb()),
      clock: systemClock,
      // The log never claims reception typed these women in one by one (#5). A year from now,
      // "where did this member come from?" has an answer, and the answer is the batch.
      source: 'migration',
    },
    entitlements: { repo: new FirestoreEntitlementRepository(adminDb()), clock: systemClock },
  }
}

/**
 * The catalogue entries the rows need, read once.
 *
 * Kept out of `core` deliberately: the product DOCUMENT shape is Firestore's, and the use-case
 * should be handed grants it can apply rather than reach for a collection itself.
 */
export async function loadCatalogue(
  ctx: TenantContext,
  productIds: readonly ProductId[],
): Promise<readonly ImportProduct[]> {
  const out: ImportProduct[] = []
  for (const id of [...new Set(productIds)]) {
    const snap = await adminDb().doc(`studios/${ctx.studioId}/products/${id}`).get()
    if (!snap.exists) continue
    const p = snap.data()!
    const isCredit = p.type === 'credit'
    out.push({
      productId: id,
      snapshot: {
        productId: id,
        name: String(p.name),
        category: p.category,
        grant: isCredit
          ? { kind: 'credits', credits: Number(p.creditCount ?? 0), validForDays: Number(p.durationDays ?? 30) }
          : { kind: 'period', durationDays: Number(p.durationDays ?? 30), access: 'unlimited' },
        listPrice: money(Number(p.priceInKurus ?? 0)),
        serviceIds: p.serviceIds ?? [],
        cancellationAllowanceCount: p.cancellationAllowanceCount ?? null,
        dailyReservationLimit: p.dailyReservationLimit ?? null,
        activeReservationLimit: p.activeReservationLimit ?? null,
        entryAllowance: p.entryAllowance ?? null,
      },
      freezeDays: Number(p.freezeAllowanceDays ?? 0) > 0 ? Number(p.freezeAllowanceDays) : null,
    })
  }
  return out
}
