import {
  FirestoreCatalogRepository,
  FirestoreSchedulingRepository,
  type TenantContext,
} from '@studio/core'

import { adminDb } from './firebase-admin'

export interface ServiceOption {
  readonly id: string
  readonly name: string
  readonly category: string
}

// Active services, for the package form's "Hizmet(ler)" picker (informational scope).
export async function listServiceOptions(ctx: TenantContext): Promise<readonly ServiceOption[]> {
  const services = await new FirestoreSchedulingRepository(adminDb()).listServices(ctx)
  return services
    .filter((s) => s.active)
    .map((s) => ({ id: s.id, name: s.name, category: s.category }))
}

export interface ProductView {
  readonly id: string
  readonly name: string
  readonly category: string
  readonly serviceIds: readonly string[]
  readonly type: 'credit' | 'period'
  readonly durationDays: number
  readonly creditCount: number | null
  readonly priceInKurus: number
  readonly freezeAllowanceDays: number
  readonly dailyReservationLimit: number | null
  readonly cancellationAllowanceCount: number | null
  readonly activeReservationLimit: number | null
  readonly description: string
  readonly active: boolean
}

export async function listProducts(ctx: TenantContext): Promise<readonly ProductView[]> {
  const products = await new FirestoreCatalogRepository(adminDb()).listProducts(ctx)
  return products
    .map((p) => ({
      id: p.id,
      name: p.name,
      category: p.category,
      serviceIds: p.serviceIds,
      type: p.type,
      durationDays: p.durationDays,
      creditCount: p.creditCount,
      priceInKurus: p.priceInKurus,
      freezeAllowanceDays: p.freezeAllowanceDays,
      dailyReservationLimit: p.dailyReservationLimit,
      cancellationAllowanceCount: p.cancellationAllowanceCount,
      activeReservationLimit: p.activeReservationLimit,
      description: p.description,
      active: p.active,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'tr'))
}
