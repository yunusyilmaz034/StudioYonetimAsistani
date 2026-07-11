import { getFirestore, type CollectionReference, type Firestore } from 'firebase-admin/firestore'

import type { NewEvent, ProductId, StudioId, TenantContext } from '../../../shared'
import type { CatalogRepository } from '../application/ports'
import type { Product } from '../domain/types'
import { eventToFirestore, productFromFirestore, productToFirestore } from './mappers'

export class FirestoreCatalogRepository implements CatalogRepository {
  constructor(private readonly db: Firestore = getFirestore()) {}

  private col(sid: StudioId, name: string): CollectionReference {
    return this.db.collection('studios').doc(sid).collection(name)
  }

  async getProduct(ctx: TenantContext, id: ProductId): Promise<Product | null> {
    const s = await this.col(ctx.studioId, 'products').doc(id).get()
    const d = s.data()
    return d ? productFromFirestore(id, d) : null
  }

  async listProducts(ctx: TenantContext): Promise<readonly Product[]> {
    const snap = await this.col(ctx.studioId, 'products').get()
    return snap.docs.map((doc) => productFromFirestore(doc.id as ProductId, doc.data()))
  }

  async saveProduct(ctx: TenantContext, product: Product, events: readonly NewEvent[]): Promise<void> {
    const batch = this.db.batch()
    batch.set(this.col(ctx.studioId, 'products').doc(product.id), productToFirestore(product))
    for (const e of events) {
      const { id, data } = eventToFirestore(e)
      batch.set(this.col(ctx.studioId, 'events').doc(id), data)
    }
    await batch.commit()
  }
}
