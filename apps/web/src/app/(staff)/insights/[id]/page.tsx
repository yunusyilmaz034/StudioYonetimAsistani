import { notFound, redirect } from 'next/navigation'

import { requirePageAccess } from '@/server/auth'
import { loadOwnerDashboard } from '@/server/owner-dashboard'
import { WIDGETS } from '@/lib/widgets/registry'

import { InsightScreen } from './insight-screen'

// A dashboard number that cannot be acted on is a poster. Every list widget opens HERE, as its full
// list — the same data, unclipped, exportable. The screen is generic: it renders whatever the
// widget's export table says, so a new widget needs no new page.
export default async function InsightPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePageAccess('/analytics')
  if (!ctx) redirect('/login')

  const { id } = await params
  const widget = WIDGETS.find((w) => w.id === decodeURIComponent(id))
  if (!widget || !widget.table) notFound()

  const data = await loadOwnerDashboard(ctx, Date.now())
  const presentation = widget.present(data)
  const table = widget.table(data)

  return (
    <InsightScreen
      title={widget.title}
      headline={presentation.headline}
      detail={presentation.detail ?? null}
      table={table}
    />
  )
}
