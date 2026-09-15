'use server'

import {
  countEntitlementsOffProduct,
  createProduct,
  FirestoreCatalogRepository,
  FirestoreEntitlementRepository,
  syncEntitlementsToProduct,
  systemClock,
  updateProduct,
  type CatalogDeps,
  type EntitlementsDeps,
  type Category,
  type ProductComponent,
  type ProductId,
  type ServiceId,
} from '@studio/core'
import { z } from 'zod'

import { requireTenantContext } from '../auth'
import { adminDb } from '../firebase-admin'

// Catalogue writes are owner + platform_admin (AD-46); reception reads and sells but
// does not edit the price list.
const DEFS = ['owner', 'platform_admin'] as const

function deps(): CatalogDeps {
  return { repo: new FirestoreCatalogRepository(adminDb()), clock: systemClock }
}

const fields = z.object({
  name: z.string().min(1),
  category: z.enum(['pilates_group', 'fitness', 'private']),
  serviceIds: z.array(z.string()).default([]),
  type: z.enum(['credit', 'period']),
  durationDays: z.number().int().min(1),
  creditCount: z.number().int().min(1).nullable(),
  priceInKurus: z.number().int().min(0),
  // Desk cash price. Optional and nullable: a studio that charges one price simply never sets it,
  // and every product written before this existed keeps behaving as it did.
  cashPriceInKurus: z.number().int().min(0).nullable().default(null),
  freezeAllowanceDays: z.number().int().min(0),
  dailyReservationLimit: z.number().int().min(1).nullable(),
  cancellationAllowanceCount: z.number().int().min(0).nullable(),
  activeReservationLimit: z.number().int().min(1).nullable(),
  entryAllowance: z.number().int().min(1).nullable().default(null),
  // Hibrit demet bileşenleri (v1.30). null/absent ⇒ normal ürün.
  components: z
    .array(
      z.object({
        category: z.enum(['pilates_group', 'fitness', 'private']),
        creditCount: z.number().int().min(0).nullable(),
        entryAllowance: z.number().int().min(0).nullable(),
        label: z.string(),
      }),
    )
    .nullable()
    .default(null),
  description: z.string(),
  onlineSellable: z.boolean().default(false),
  memberSellable: z.boolean().default(false),
})

function toFields(p: z.infer<typeof fields>) {
  return {
    name: p.name,
    category: p.category as Category,
    serviceIds: p.serviceIds as ServiceId[],
    type: p.type,
    durationDays: p.durationDays,
    creditCount: p.type === 'credit' ? p.creditCount : null,
    priceInKurus: p.priceInKurus,
    cashPriceInKurus: p.cashPriceInKurus,
    freezeAllowanceDays: p.freezeAllowanceDays,
    dailyReservationLimit: p.dailyReservationLimit,
    cancellationAllowanceCount: p.cancellationAllowanceCount,
    activeReservationLimit: p.activeReservationLimit,
    // Only a PERIOD (unlimited-access) membership carries an entry cap; a credit package caps itself.
    entryAllowance: p.type === 'period' ? p.entryAllowance : null,
    components: (p.components as ProductComponent[] | null) ?? null,
    description: p.description,
    // PT/private is never online (coordination-heavy); the form also hides the toggle for it.
    // PT is forced off on BOTH channels server-side, not merely hidden in the form: a checkbox that
    // only exists in the UI is a rule anyone can post around.
    onlineSellable: p.category === 'private' ? false : p.onlineSellable,
    memberSellable: p.category === 'private' ? false : p.memberSellable,
  }
}

export async function createProductAction(input: unknown) {
  const p = fields.parse(input)
  return createProduct(deps(), await requireTenantContext(DEFS), toFields(p))
}

export async function updateProductAction(input: unknown) {
  const p = fields.extend({ productId: z.string().min(1), active: z.boolean() }).parse(input)
  return updateProduct(deps(), await requireTenantContext(DEFS), {
    ...toFields(p),
    productId: p.productId as ProductId,
    active: p.active,
  })
}

// ── SATILMIŞ PAKETLERİ ÜRÜNLE EŞİTLE (owner, 2026-09-15) ───────────────────────────────────────
//
// "PT PİLATES 6 AY" satıştan 18 dakika sonra PT kategorisine düzeltildi; satılmış iki paketin kopyası eski
// kategoride kaldı ve üyeler PT seansına alınamadı. Paket formu kategori değişince bu sayıyı sorar ve owner
// onaylarsa eşitler. Kredi, fiyat, süre dokunulmaz — bkz. `decideSyncSnapshotToProduct`.
function entDeps(): EntitlementsDeps {
  return { repo: new FirestoreEntitlementRepository(adminDb()), clock: systemClock }
}

async function coverageOf(ctx: Awaited<ReturnType<typeof requireTenantContext>>, productId: string) {
  const product = await deps().repo.getProduct(ctx, productId as ProductId)
  return product ? { productId: product.id, category: product.category, serviceIds: product.serviceIds } : null
}

export async function productOffSyncCountAction(input: unknown): Promise<number> {
  const p = z.object({ productId: z.string().min(1) }).parse(input)
  const ctx = await requireTenantContext(DEFS)
  const coverage = await coverageOf(ctx, p.productId)
  return coverage ? countEntitlementsOffProduct(entDeps(), ctx, coverage) : 0
}

export async function syncProductEntitlementsAction(input: unknown) {
  const p = z.object({ productId: z.string().min(1), reason: z.string().trim().min(1).max(300) }).parse(input)
  const ctx = await requireTenantContext(DEFS)
  const coverage = await coverageOf(ctx, p.productId)
  if (!coverage) return { ok: false as const, error: { code: 'operation_not_applicable' as const } }
  return syncEntitlementsToProduct(entDeps(), ctx, { product: coverage, reason: p.reason })
}
