'use server'

import {
  createProduct,
  FirestoreCatalogRepository,
  systemClock,
  updateProduct,
  type CatalogDeps,
  type Category,
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
  freezeAllowanceDays: z.number().int().min(0),
  dailyReservationLimit: z.number().int().min(1).nullable(),
  cancellationAllowanceCount: z.number().int().min(0).nullable(),
  activeReservationLimit: z.number().int().min(1).nullable(),
  description: z.string(),
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
    freezeAllowanceDays: p.freezeAllowanceDays,
    dailyReservationLimit: p.dailyReservationLimit,
    cancellationAllowanceCount: p.cancellationAllowanceCount,
    activeReservationLimit: p.activeReservationLimit,
    description: p.description,
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
