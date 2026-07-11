import { redirect } from 'next/navigation'

import { getTenantContext } from '@/server/auth'
import { loadCheckinState } from '@/server/checkin-query'
import { listMembers } from '@/server/members-query'

import { CheckinScreen } from './checkin-screen'

// Reception check-in (Doc 2 §9). Reads the branch occupancy state, who is inside, and
// the "expected but absent" list; check-ins go through the offline /commands path.
export default async function CheckinPage() {
  const ctx = await getTenantContext()
  if (!ctx) {
    redirect('/login')
  }
  const [state, members] = await Promise.all([loadCheckinState(ctx, Date.now()), listMembers(ctx)])
  return (
    <CheckinScreen
      state={state}
      members={members
        .filter((m) => m.status === 'active')
        .map((m) => ({ id: m.id, fullName: m.fullName, phone: m.phone }))}
    />
  )
}
