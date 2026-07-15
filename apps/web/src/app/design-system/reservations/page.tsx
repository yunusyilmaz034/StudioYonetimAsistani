import { notFound } from 'next/navigation'

import { Toaster } from '@/components/ui/sonner'

import { ReservationPreview } from './preview'

// Dev-only (Doc 09 §12) — an interactive preview of the reservation operations screen on mock data.
// Booking and cancelling work against an in-memory day, so the flow can be felt without a login. 404
// in production.
export default function ReservationPreviewPage() {
  if (process.env.NODE_ENV === 'production') {
    notFound()
  }
  return (
    <>
      <ReservationPreview />
      <Toaster />
    </>
  )
}
