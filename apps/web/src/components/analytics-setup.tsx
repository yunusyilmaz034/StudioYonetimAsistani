'use client'

import { useEffect } from 'react'

import { setAnalyticsContext, trackError } from '@/lib/analytics'

// Mounted once per surface (the staff shell, the member portal). It does two things and both are
// best-effort: it stamps the non-PII analytics context (studio + role) so every event is attributable
// without identifying anyone, and it wires the two global error sinks — an uncaught exception and an
// unhandled promise rejection — to `trackError`. This is the web stand-in for a crash reporter: it
// catches what a component-level boundary never sees (event handlers, async work, third-party code).
export function AnalyticsSetup({
  studioId,
  role,
  branchId,
}: {
  studioId?: string
  role?: string
  branchId?: string
}) {
  useEffect(() => {
    setAnalyticsContext({
      ...(studioId ? { studioId } : {}),
      ...(branchId ? { branchId } : {}),
      ...(role ? { role } : {}),
    })

    const onError = (e: ErrorEvent) => trackError(e.error ?? e.message, { where: 'window.onerror' })
    const onRejection = (e: PromiseRejectionEvent) =>
      trackError(e.reason, { where: 'unhandledrejection' })

    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onRejection)
    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onRejection)
    }
  }, [studioId, role, branchId])

  return null
}
