import { requirePageAccess } from '@/server/auth'
import { loadCheckinState } from '@/server/checkin-query'
import { listBookingMembersAction } from '@/server/actions/booking'

import { KioskScreen } from './kiosk-screen'

// THE KIOSK (v1.27 S4 · owner, 2026-07-13).
//
// **This is an iPad on a wall, not a screen on a desk.** Everything about it follows from that:
//
//   • The member operates it, not reception. She holds up her phone and walks in. So: one thing on
//     screen at a time, targets big enough for a thumb at arm's length, and no navigation — a member
//     must not be one stray tap away from the members list.
//   • It resets ITSELF. Nobody is standing there to clear the last woman's name off the screen, and
//     a kiosk showing "Hoş geldin Ayşe" to Fatma is a kiosk that has told Fatma who came before her.
//   • It is honest about the internet. QR is online-only by design (D16 — a signature is verified on
//     the server or it is not verified), so when the connection drops the kiosk SAYS SO and points at
//     the desk, rather than scanning a code it can do nothing with.
//
// It runs under reception's session — the tablet is signed in once, in the morning. We did NOT invent
// an unauthenticated kiosk mode: that would be a new authentication surface, and the studio's problem
// is a camera that does not work on Safari, not a login it does not want to do.
export default async function KioskPage() {
  const ctx = await requirePageAccess('/checkin')
  const [state, members] = await Promise.all([
    loadCheckinState(ctx, Date.now()),
    listBookingMembersAction(),
  ])

  return <KioskScreen state={state} members={members} />
}
