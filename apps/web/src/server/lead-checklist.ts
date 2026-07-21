import type { TenantContext } from '@studio/core'

import { adminDb } from './firebase-admin'
import type { AdvisorItem } from './advisor-query'

// Turn the WhatsApp AI receptionist's HOT (or waiting-for-operator) conversations into checklist items —
// so "5 sıcak lead var, bunlarla özel ilgilen" lands on the dashboard's "Bugün İlgilenmen Gerekenler"
// list next to the debt/churn signals. A bounded read; server-only conversations, so it's read here.
export async function hotLeadAdvisorItems(ctx: TenantContext): Promise<readonly AdvisorItem[]> {
  const snap = await adminDb().collection(`studios/${ctx.studioId}/conversations`).orderBy('lastAt', 'desc').limit(50).get()
  const items: AdvisorItem[] = []
  for (const d of snap.docs) {
    const c = d.data() as Record<string, unknown>
    const hot = c.temp === 'sıcak'
    const waiting = Boolean(c.needsAttention)
    if (!hot && !waiting) continue
    const phone = String(c.phone ?? d.id)
    const name = String(c.name || phone.slice(-6))
    items.push({
      id: `wa:${phone}`,
      kind: 'hot_lead',
      severity: waiting ? 'urgent' : 'attention',
      subject: { id: phone, name },
      title: waiting ? `${name} — operatör bekliyor (WhatsApp)` : `Sıcak lead: ${name} (WhatsApp)`,
      detail: String(c.reason || 'İlgili görünüyor — bir an önce dönün.'),
      href: `/conversations?phone=${encodeURIComponent(phone)}`,
      actionLabel: 'Sohbeti aç',
    })
  }
  // Waiting (urgent) first, then hot.
  return items.sort((a, b) => (a.severity === 'urgent' ? 0 : 1) - (b.severity === 'urgent' ? 0 : 1))
}
