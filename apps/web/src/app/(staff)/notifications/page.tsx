import { redirect } from 'next/navigation'

import { requirePageAccess } from '@/server/auth'
import { listNotificationsAction, listNotificationTemplatesAction } from '@/server/actions/notifications'

import { NotificationsScreen } from './notifications-screen'

// The Notification Center. NOT a "send an SMS" screen (owner): it is the centre of Intent · Queue ·
// Attempt · Delivery · Retry · Audit. The whole area is desk-gated (owner + reception); a trainer
// never reaches it, so there is no per-trainer view to fabricate — template editing and bulk send
// are narrowed further, to the owner alone.
export default async function NotificationsPage() {
  const ctx = await requirePageAccess('/notifications')
  if (!ctx) redirect('/login')
  const canManage = ctx.role === 'owner'
  const [rows, templates] = await Promise.all([
    listNotificationsAction(),
    listNotificationTemplatesAction(),
  ])
  return <NotificationsScreen initial={rows} templates={templates} canManage={canManage} />
}
