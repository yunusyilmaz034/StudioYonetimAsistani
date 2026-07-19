'use client'

import { useEffect } from 'react'

import { track } from '@/lib/analytics'

// A funnel signal ONLY. The browser return is not proof of payment — the money truth is the server
// callback + the event it writes (see the page comment). This just closes the analytics funnel that
// `payment_started` opened, tagged with what the browser was told. Never read it as revenue.
export function PaymentReturnTrack({ success }: { success: boolean }) {
  useEffect(() => {
    track(success ? 'payment_succeeded' : 'payment_failed', { confirmed: false })
  }, [success])
  return null
}
