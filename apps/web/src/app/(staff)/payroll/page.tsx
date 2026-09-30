import { requirePageAccess } from '@/server/auth'
import { reportPinIsDefault, reportsUnlocked } from '@/server/report-pin'
import { ReportPinGate } from '@/components/report-pin-gate'
import { listPlansAction, listTrainersAction } from '@/server/actions/payroll'

import { PayrollScreen } from './payroll-screen'

// Bordro (Plus Phase 9) — owner-only. The studio's trainers, their compensation plans, and each
// trainer's earnings for a period (derived from realised classes + attributed sales), which the owner
// adjusts, finalizes and marks paid. Reception has no access; a trainer sees only her own (/my-payroll).
export default async function PayrollPage() {
  const ctx = await requirePageAccess('/payroll')
  // KİLİT, VERİYİ ÇEKMEDEN ÖNCE ([[OR-117]]). Sıra burada önemli: aşağıdaki iki işlem de kilidi
  // arıyor ve kilitliyken fırlatıyor — önce sormasaydık sayfa PIN ekranı yerine hata gösterirdi.
  if (!(await reportsUnlocked(String(ctx.studioId), String(ctx.actor.id)))) {
    return <ReportPinGate varsayilan={await reportPinIsDefault(String(ctx.studioId))} />
  }
  const [trainers, plans] = await Promise.all([listTrainersAction(), listPlansAction()])
  return <PayrollScreen trainers={trainers} initialPlans={plans} />
}
