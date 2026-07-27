import { redirect } from 'next/navigation'

import { requirePageAccess } from '@/server/auth'

// PF-40 (2026-07-27) — this screen became a REPORT.
//
// It was never a different kind of thing from the seven on `/reports`: the same date range over the
// same events, drawn instead of listed. Two screens meant two date pickers and two export buttons
// for one question, and a menu in which "Raporlar" and "Analiz" could not be told apart by name.
//
// The route stays as a redirect rather than being deleted. It is in the owner's history, possibly in
// a bookmark, and a 404 for a screen that still exists — under a different name, one click away —
// is a worse answer than sending her to it. The access check runs FIRST: a redirect must not become
// a way to learn that an owner-only screen exists.
export default async function AnalyticsPage() {
  await requirePageAccess('/analytics')
  redirect('/reports?r=trend')
}
