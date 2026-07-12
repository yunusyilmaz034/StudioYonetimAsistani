import { redirect } from 'next/navigation'

import { getTenantContext } from '@/server/auth'
import { listBulkAction, listClosuresAction } from '@/server/actions/operations'

import { OperationsScreen } from './operations-screen'

export default async function OperationsPage() {
  const ctx = await getTenantContext()
  if (!ctx) redirect('/login')
  if (ctx.role !== 'owner') redirect('/')

  const [closures, bulk] = await Promise.all([listClosuresAction(), listBulkAction()])
  return (
    <OperationsScreen
      closures={closures.map((c) => ({
        id: c.id,
        operationId: c.operationId,
        dateFrom: c.dateFrom,
        dateTo: c.dateTo,
        reason: c.reason,
        status: c.status,
        extensionDays: c.extensionDays,
        appliedAt: c.appliedAt,
        summary: c.summary,
      }))}
      bulk={bulk.map((b) => ({
        id: b.id,
        operationId: b.operationId,
        action: b.action.kind,
        amount: b.action.kind === 'extend_days' ? b.action.days : b.action.credits,
        reason: b.reason,
        note: b.note,
        status: b.status,
        appliedAt: b.appliedAt,
        summary: b.summary,
      }))}
    />
  )
}
