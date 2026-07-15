import { getPaymentProviderSettingsAction } from '@/server/actions/payments'
import { requirePageAccess } from '@/server/auth'

import { IntegrationsScreen } from './integrations-screen'

// Ayarlar › Entegrasyonlar › Ödeme Sağlayıcıları (Plus Phase 6). Owner-only, gated against /settings.
// Business logic is provider-based; PAYTR is the first provider behind the port, never wired directly.
export default async function IntegrationsPage() {
  await requirePageAccess('/settings')
  const { config, secretsPresent } = await getPaymentProviderSettingsAction()
  return <IntegrationsScreen config={config} secretsPresent={secretsPresent} />
}
