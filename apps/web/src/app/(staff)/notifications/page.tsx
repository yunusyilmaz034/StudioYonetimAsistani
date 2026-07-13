import { redirect } from 'next/navigation'

import { getTenantContext } from '@/server/auth'
import { listNotificationsAction } from '@/server/actions/notifications'

import { NotificationsScreen } from './notifications-screen'

// The Notification Center. NOT a "send an SMS" screen (owner): it is the centre of Intent · Queue ·
// Attempt · Delivery · Retry · Audit.
export default async function NotificationsPage() {
  const ctx = await getTenantContext()
  if (!ctx) redirect('/login')
  const rows = await listNotificationsAction()
  return <NotificationsScreen initial={rows} isOwner={ctx.role === 'owner'} />
}
