import { redirect } from 'next/navigation'

import { requirePageAccess } from '@/server/auth'

import { BulkScreen } from './bulk-screen'

// Toplu rezervasyon işlemleri (v1.27 S7). It lives UNDER `/reservations` on purpose: a reservation is
// managed in the reservation workspace, and a bulk act is not a different object — it is the same
// object, eight at a time. Same permission area, no new nav entry, no new door to guard.
export default async function BulkReservationsPage() {
  const ctx = await requirePageAccess('/reservations')
  if (!ctx) redirect('/login')
  return <BulkScreen />
}
