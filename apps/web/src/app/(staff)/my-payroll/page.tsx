import { requirePageAccess } from '@/server/auth'

import { MyPayrollScreen } from './my-payroll-screen'

// Hakedişim (Plus Phase 9) — the trainer's read-only view of her OWN earnings. She picks a period and
// sees what she earned; she cannot edit a rate, finalize, pay, or see any other trainer. The owner may
// open it too. The Server Action forces trainerId to the session, so this is safe even for the owner.
export default async function MyPayrollPage() {
  await requirePageAccess('/my-payroll')
  return <MyPayrollScreen />
}
