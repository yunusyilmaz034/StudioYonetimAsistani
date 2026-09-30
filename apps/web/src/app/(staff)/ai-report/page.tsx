import { requirePageAccess } from '@/server/auth'

import { AiReportScreen } from './ai-report-screen'

// Faz 2 — "AI Rapor". The WhatsApp AI receptionist's funnel + efficiency, owner-only.
export default async function AiReportPage() {
  await requirePageAccess('/ai-report')
  return <AiReportScreen />
}
