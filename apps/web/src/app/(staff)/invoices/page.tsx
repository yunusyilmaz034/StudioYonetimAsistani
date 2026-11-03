import { redirect } from 'next/navigation'

import { requirePageAccess } from '@/server/auth'

import { InvoicesScreen } from './invoices-screen'

// Fatura Takibi (owner, 2026-11-03). Owner-only; the PIN gate lives inside the screen, the same
// unlock as the money reports.
export default async function InvoicesPage() {
  const ctx = await requirePageAccess('/invoices')
  if (!ctx) redirect('/login')
  return <InvoicesScreen />
}
