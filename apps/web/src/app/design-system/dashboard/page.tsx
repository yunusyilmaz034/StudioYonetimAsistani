import { notFound } from 'next/navigation'

import { DashboardPreview } from './preview'

// Development-only (Doc 09 §12) — a vibrant preview of the Plus owner dashboard on sample data, so the
// design language can be seen full and alive without a login or a database. 404 in production.
export default function DashboardPreviewPage() {
  if (process.env.NODE_ENV === 'production') {
    notFound()
  }
  return <DashboardPreview />
}
