import { requirePageAccess } from '@/server/auth'

import { AdsScreen } from './ads-screen'

// IG-4a — "Reklamlar": what the ad money brought (spend → messages → leads → members → revenue).
// Owner-only, read-only. Every ad CHANGE is a later milestone and goes through the owner's approval.
export default async function AdsPage() {
  await requirePageAccess('/ads')
  return <AdsScreen />
}
