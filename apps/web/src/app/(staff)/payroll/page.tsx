import { requirePageAccess } from '@/server/auth'
import { listPlansAction, listTrainersAction } from '@/server/actions/payroll'

import { PayrollScreen } from './payroll-screen'

// Bordro (Plus Phase 9) — owner-only. The studio's trainers, their compensation plans, and each
// trainer's earnings for a period (derived from realised classes + attributed sales), which the owner
// adjusts, finalizes and marks paid. Reception has no access; a trainer sees only her own (/my-payroll).
export default async function PayrollPage() {
  await requirePageAccess('/payroll')
  const [trainers, plans] = await Promise.all([listTrainersAction(), listPlansAction()])
  return <PayrollScreen trainers={trainers} initialPlans={plans} />
}
