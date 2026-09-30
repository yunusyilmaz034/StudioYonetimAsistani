import { Suspense } from 'react'
import { redirect } from 'next/navigation'

import { requirePageAccess } from '@/server/auth'
import { reportPinIsDefault, reportsUnlocked } from '@/server/report-pin'

import { ReportPinGate } from './pin-gate'
import { ReportsScreen } from './reports-screen'

// The reports (v1.27 S6; the trend joined them in PF-40). Owner-only: reception does not get finance
// reports, and bulk export is the owner's alone (owner, 2026-07-13).
//
// The Suspense boundary is required, not decorative: the screen reads `?r=` to pick a report, and
// `useSearchParams` opts a component out of prerendering unless it sits inside one.
export default async function ReportsPage() {
  const ctx = await requirePageAccess('/reports')
  if (!ctx) redirect('/login')
  // İKİNCİ KAPI (owner, 2026-09-30). Rol kapısı kimin girebileceğini söyler; bu kapı, açık
  // bırakılmış bir oturumun başına geçen kişiyi durdurur. Sunucuda sorulur — ekranı gizleyip
  // veriyi göndermek perde olurdu, o yüzden `loadReportAction` da aynı kilidi arıyor.
  if (!(await reportsUnlocked(String(ctx.studioId), String(ctx.actor.id)))) {
    return <ReportPinGate varsayilan={await reportPinIsDefault(String(ctx.studioId))} />
  }
  return (
    <Suspense fallback={null}>
      <ReportsScreen />
    </Suspense>
  )
}
