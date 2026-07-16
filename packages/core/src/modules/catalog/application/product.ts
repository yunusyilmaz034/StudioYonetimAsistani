import {
  newProductId,
  type Category,
  type DomainError,
  type ProductId,
  type Result,
  type ServiceId,
  type TenantContext,
} from '../../../shared'
import { decideCreateProduct, decideUpdateProduct } from '../domain/decide'
import type { Product, ProductType } from '../domain/types'
import { decideContext } from './context'
import type { CatalogDeps } from './ports'

export interface ProductFields {
  readonly name: string
  readonly category: Category
  readonly serviceIds: readonly ServiceId[]
  readonly type: ProductType
  readonly durationDays: number
  readonly creditCount: number | null
  readonly priceInKurus: number
  readonly freezeAllowanceDays: number
  readonly dailyReservationLimit: number | null
  readonly cancellationAllowanceCount: number | null
  readonly activeReservationLimit: number | null
  readonly description: string
}

// D12 — a package must name the services it covers. Without this, "covers nothing" and
// "covers the whole category" are the same value, and eligibility goes back to being guessed
// from a name. Refused, never defaulted.
function requiresService(input: ProductFields): DomainError | null {
  return input.serviceIds.length === 0 ? { code: 'product_requires_service' } : null
}

export async function createProduct(
  deps: CatalogDeps,
  ctx: TenantContext,
  input: ProductFields,
): Promise<Result<{ productId: ProductId }, DomainError>> {
  const invalid = requiresService(input)
  if (invalid) return { ok: false, error: invalid }
  const product: Product = { id: newProductId(), studioId: ctx.studioId, active: true, ...input }
  await deps.repo.saveProduct(ctx, product, decideCreateProduct(decideContext(deps, ctx), product))
  return { ok: true, value: { productId: product.id } }
}

export interface UpdateProductInput extends ProductFields {
  readonly productId: ProductId
  readonly active: boolean
}

export async function updateProduct(
  deps: CatalogDeps,
  ctx: TenantContext,
  input: UpdateProductInput,
): Promise<Result<void, DomainError>> {
  const invalid = requiresService(input)
  if (invalid) return { ok: false, error: invalid }
  const current = await deps.repo.getProduct(ctx, input.productId)
  if (!current) throw new Error(`Product not found: ${input.productId}`)
  const next: Product = {
    ...current,
    name: input.name,
    category: input.category,
    serviceIds: input.serviceIds,
    type: input.type,
    durationDays: input.durationDays,
    creditCount: input.creditCount,
    priceInKurus: input.priceInKurus,
    freezeAllowanceDays: input.freezeAllowanceDays,
    dailyReservationLimit: input.dailyReservationLimit,
    cancellationAllowanceCount: input.cancellationAllowanceCount,
    activeReservationLimit: input.activeReservationLimit,
    description: input.description,
    active: input.active,
  }
  const events = decideUpdateProduct(decideContext(deps, ctx), current, next)
  if (events.length === 0) return { ok: true, value: undefined }
  await deps.repo.saveProduct(ctx, next, events)
  return { ok: true, value: undefined }
}
