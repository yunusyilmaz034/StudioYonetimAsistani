import { redirect } from 'next/navigation'

import { getTenantContext } from '@/server/auth'
import { loadAudit } from '@/server/activity-query'

import { AuditScreen } from './audit-screen'

// The Audit Log — OWNER ONLY (owner, 2026-07-13). The record of who changed the world must not be
// governed by the people it records.
export default async function AuditPage() {
  const ctx = await getTenantContext()
  if (!ctx) redirect('/login')
  if (ctx.role !== 'owner') redirect('/')

  const page = await loadAudit(ctx)
  return <AuditScreen initial={page} />
}
