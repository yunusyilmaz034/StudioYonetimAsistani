import { redirect } from 'next/navigation'

import { requirePageAccess } from '@/server/auth'

import { ClosureWizard } from './closure-wizard'

export default async function NewClosurePage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; reason?: string; day?: string }>
}) {
  const ctx = await requirePageAccess('/operations')
  if (!ctx) redirect('/login')
  if (ctx.role !== 'owner') redirect('/')

  const { from, to, reason, day } = await searchParams
  return (
    <ClosureWizard
      initialFrom={from ?? ''}
      initialTo={to ?? from ?? ''}
      initialReason={reason ?? ''}
      calendarDayId={day ?? null}
    />
  )
}
