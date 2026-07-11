import type { Clock, NewEvent, ProductId, TenantContext } from '../../../shared'
import type { Product } from '../domain/types'

// Admin SDK only (AD-15). Catalogue writes are owner + platform_admin (AD-46),
// enforced in the Server Action; reads are tenant-wide.
export interface CatalogRepository {
  getProduct(ctx: TenantContext, id: ProductId): Promise<Product | null>
  saveProduct(ctx: TenantContext, product: Product, events: readonly NewEvent[]): Promise<void>
  listProducts(ctx: TenantContext): Promise<readonly Product[]>
}

export interface CatalogDeps {
  readonly repo: CatalogRepository
  readonly clock: Clock
}
