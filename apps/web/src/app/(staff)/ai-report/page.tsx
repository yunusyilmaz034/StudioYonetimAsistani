import { requirePageAccess } from '@/server/auth'
import { reportPinIsDefault, reportsUnlocked } from '@/server/report-pin'
import { ReportPinGate } from '@/components/report-pin-gate'

import { AiReportScreen } from './ai-report-screen'

// Faz 2 — "AI Rapor". The WhatsApp AI receptionist's funnel + efficiency, owner-only.
//
// Rapor PIN'i burada da sorulur ([[OR-117]], owner 2026-09-30): kilit raporlarla sınırlı kalırsa,
// açık bırakılmış bir oturumun başındaki kişi aynı rakamları bu ekrandan okur.
export default async function AiReportPage() {
  const ctx = await requirePageAccess('/ai-report')
  if (!(await reportsUnlocked(String(ctx.studioId), String(ctx.actor.id)))) {
    return <ReportPinGate varsayilan={await reportPinIsDefault(String(ctx.studioId))} />
  }
  return <AiReportScreen />
}
