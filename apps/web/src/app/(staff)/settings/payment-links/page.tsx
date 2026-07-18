import { requirePageAccess } from '@/server/auth'
import { listPaymentLinksAction } from '@/server/actions/payment-links'

import { PaymentLinksScreen } from './payment-links-screen'

// PF-37 — the shareable PAYTR link generator. Its own sub-screen (like integrations), not part of the
// settings form's single "Kaydet": creating a link is its own act.
export default async function PaymentLinksPage() {
  const ctx = await requirePageAccess('/settings')
  const links = await listPaymentLinksAction()
  return <PaymentLinksScreen initial={links} studioId={ctx?.studioId ?? ''} canManage={ctx?.role === 'owner'} />
}
