import { requirePageAccess } from '@/server/auth'
import { listStaffAction } from '@/server/actions/staff'

import { StaffScreen } from './staff-screen'

// Who may work here, and as what (v1.27 S1).
//
// The owner's screen, and the owner's alone — the page guard says so, the Server Action says so, and
// the domain says so. Three locks on one door, which sounds excessive until you notice what is behind
// it: granting the receptionist role hands somebody every member's phone number and the key to the
// till, and it looks like an administrative chore while it does it.
//
// The FIRST owner does not come from here — she cannot, because there is nobody to create her. She
// comes from `pnpm bootstrap:owner`, run once, by hand, with admin credentials. Everybody after her
// comes from this screen.
export default async function StaffPage() {
  await requirePageAccess('/staff')
  const staff = await listStaffAction()
  return <StaffScreen staff={staff} />
}
