import { describe, expect, it } from 'vitest'

import { instant, type ProductId, type ServiceId, type StudioId, type TenantContext } from '../../../shared'
import type { Product } from '../domain/types'
import type { CatalogDeps } from './ports'
import { createProduct, updateProduct } from './product'

// D12 — a package must name the services it covers. Refused at the catalogue, so that
// "covers nothing" can never be written down as if it meant "covers everything".

const ctx: TenantContext = {
  studioId: 'std_1' as StudioId,
  branchIds: [],
  actor: { type: 'owner', id: 'usr_1' as never },
  role: 'owner',
} as unknown as TenantContext

const FIELDS = {
  name: 'Reformer 8',
  category: 'pilates_group' as const,
  serviceIds: ['svc_1' as ServiceId],
  type: 'credit' as const,
  durationDays: 30,
  creditCount: 8,
  priceInKurus: 420_000,
  freezeAllowanceDays: 0,
  dailyReservationLimit: null,
  cancellationAllowanceCount: null,
  activeReservationLimit: null, entryAllowance: null,
  components: null,
  description: '',
}

function deps(existing?: Product): { deps: CatalogDeps; saved: Product[] } {
  const saved: Product[] = []
  const d = {
    repo: {
      getProduct: async () => existing ?? null,
      saveProduct: async (_c: unknown, p: Product) => {
        saved.push(p)
      },
    },
    clock: { now: () => instant(1_700_000_000_000) },
    ids: { correlationId: () => 'cor_1' },
  } as unknown as CatalogDeps
  return { deps: d, saved }
}

describe('product service list (D12)', () => {
  it('creates a product that names at least one service', async () => {
    const { deps: d, saved } = deps()
    const r = await createProduct(d, ctx, FIELDS)
    expect(r.ok).toBe(true)
    expect(saved[0]?.serviceIds).toEqual(['svc_1'])
  })

  it('refuses to create a product that names no service', async () => {
    const { deps: d, saved } = deps()
    const r = await createProduct(d, ctx, { ...FIELDS, serviceIds: [] })
    expect(r).toEqual({ ok: false, error: { code: 'product_requires_service' } })
    expect(saved).toHaveLength(0) // refused, not clamped to a default
  })

  it('refuses to strip every service from an existing product', async () => {
    const current: Product = {
      id: 'prd_1' as ProductId,
      studioId: 'std_1' as StudioId,
      active: true,
      ...FIELDS,
    }
    const { deps: d, saved } = deps(current)
    const r = await updateProduct(d, ctx, {
      ...FIELDS,
      serviceIds: [],
      productId: 'prd_1' as ProductId,
      active: true,
    })
    expect(r).toEqual({ ok: false, error: { code: 'product_requires_service' } })
    expect(saved).toHaveLength(0)
  })
})
