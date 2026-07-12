import { redirect } from 'next/navigation'

import { getTenantContext } from '@/server/auth'

import { BulkWizard } from './bulk-wizard'

export default async function BulkPage() {
  const ctx = await getTenantContext()
  if (!ctx) redirect('/login')
  if (ctx.role !== 'owner') redirect('/')
  return <BulkWizard />
}
