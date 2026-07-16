import { redirect } from 'next/navigation'

import { requirePageAccess } from '@/server/auth'

import { RetailScreen } from './retail-screen'

// "Ürün Sat" — the retail sale surface. Selling is operational (reception's day), so it lives in the
// nav on its own, not in Ayarlar (which only manages the product catalogue). Owner + reception.
export default async function RetailPage() {
  const ctx = await requirePageAccess('/retail')
  if (!ctx) redirect('/login')
  return <RetailScreen />
}
