import { notFound } from 'next/navigation'

import { Toaster } from '@/components/ui/sonner'

import { ReservationCalendarPreview } from './preview'

// Dev-only (Doc 09 §12) — the restored calendar reservation agenda on mock data, so the new palette
// can be seen on the real calendar layout without a login. 404 in production.
export default function ReservationCalendarPreviewPage() {
  if (process.env.NODE_ENV === 'production') {
    notFound()
  }
  return (
    <>
      <ReservationCalendarPreview />
      <Toaster />
    </>
  )
}
