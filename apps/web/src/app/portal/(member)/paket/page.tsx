import type { Metadata } from 'next'

import { listBuyableProductsAction } from '@/server/actions/portal'

import { BuyScreen } from './buy-screen'

// PAKET AL / YENİLE — the portal's half of the renewal loop (2026-07-27).
//
// The app got this first; the portal needs it more. iOS launched today and Android is still in
// closed testing, so almost every member of this studio is here, in a browser. A renewal she can
// only reach from an iPhone is one most of them cannot reach at all.
export const metadata: Metadata = { title: 'Paket Al' }
export const dynamic = 'force-dynamic'

export default async function PaketPage() {
  return <BuyScreen items={await listBuyableProductsAction()} />
}
