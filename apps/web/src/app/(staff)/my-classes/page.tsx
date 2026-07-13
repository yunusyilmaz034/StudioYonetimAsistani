import { requirePageAccess } from '@/server/auth'
import { studioToday } from '@/server/reservations-query'

import { MyClassesScreen } from './my-classes-screen'

// The trainer's ONE screen (v1.27 S1 · owner's permission matrix, 2026-07-13).
//
// She is staff, and she is also the person least entitled to the studio's data. So this is not the
// reception dashboard with a few things hidden — it is a different screen, built for the person who
// walks into a room with eight women in it and needs to know who they are and who turned up.
//
// Her week. Her classes. Her registers. The names of the women in front of her, and nothing else:
// not a phone number, not a package, not a balance, not another trainer's roster. The server refuses
// a session that is not hers (`getMyRosterAction`) — the screen does not merely hide it, because a
// session id is a guessable string and hiding is not a security boundary.
export default async function MyClassesPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>
}) {
  const ctx = await requirePageAccess('/my-classes')
  const { date } = await searchParams
  return <MyClassesScreen date={date ?? studioToday()} trainerName={ctx.actor.id} />
}
