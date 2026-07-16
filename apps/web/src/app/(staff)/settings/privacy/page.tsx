import { requirePageAccess } from '@/server/auth'

import { PrivacyScreen } from './privacy-screen'

// Ayarlar › KVKK / Gizlilik (PF-9). Gated at /settings like Entegrasyonlar; the erasure action itself
// enforces platform_admin (AD-67) — the screen is the door, `decideErase` is the lock.
export default async function PrivacyPage() {
  await requirePageAccess('/settings')
  return <PrivacyScreen />
}
