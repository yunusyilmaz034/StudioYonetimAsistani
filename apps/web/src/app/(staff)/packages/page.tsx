import { redirect } from 'next/navigation'

import { getTenantContext } from '@/server/auth'
import { listProducts, listServiceOptions } from '@/server/catalog-query'

import { PackagesScreen } from './packages-screen'

// Package Catalogue (Doc 2 §5.1, AD-41) — the modern "Üyelik Seçenekleri" screen.
// Owner/platform_admin create and edit package templates; they are never deleted,
// only deactivated. Writes go through Server Actions (AD-46).
export default async function PackagesPage() {
  const ctx = await getTenantContext()
  if (!ctx) {
    redirect('/login')
  }
  const [products, services] = await Promise.all([listProducts(ctx), listServiceOptions(ctx)])
  return <PackagesScreen products={products} services={services} />
}
