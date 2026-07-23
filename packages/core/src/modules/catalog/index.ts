// The catalog module's only public door (AD-29). The package catalogue is data
// (AD-41): products are created, edited, deactivated — never a literal in code, never
// deleted. `entitlement.productSnapshot` freezes what a member bought.
export type { Product, ProductComponent, ProductType } from './domain/types'
export * from './events'
export {
  createProduct,
  updateProduct,
  type ProductFields,
  type UpdateProductInput,
} from './application/product'
export type { CatalogDeps, CatalogRepository } from './application/ports'
export { FirestoreCatalogRepository } from './infrastructure/repos'
