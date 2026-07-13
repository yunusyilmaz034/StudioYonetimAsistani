import { redirect } from 'next/navigation'

import { requirePageAccess } from '@/server/auth'

import { BulkWizard } from './bulk-wizard'

export default async function BulkPage() {
  const ctx = await requirePageAccess('/operations')
  if (!ctx) redirect('/login')
  if (ctx.role !== 'owner') redirect('/')
  return <BulkWizard />
}
