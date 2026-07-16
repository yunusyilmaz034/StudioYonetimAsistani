import { requirePageAccess } from '@/server/auth'
import { listExercisesAction, listOpenFeedbackAction } from '@/server/actions/training'
import { listMembers } from '@/server/members-query'

import { TrainingScreen } from './training-screen'

// The TRAINING workspace (Plus Phase 7) — owner + trainer. Two studio-wide surfaces: the exercise
// library (the shared catalogue the programmes snapshot from) and the feedback center (the member's
// per-exercise questions, routed to the trainer who owns her programme). Per-member programme,
// measurement and photo work lives on the member card, not here.
//
// Member NAMES are exposed only for the members who actually left open feedback — a trainer's own
// trainees — never the whole roster.
export default async function TrainingPage() {
  const ctx = await requirePageAccess('/training')
  const [exercises, feedback, members] = await Promise.all([
    listExercisesAction(),
    listOpenFeedbackAction(),
    listMembers(ctx),
  ])
  const involved = new Set(feedback.map((f) => f.memberId))
  const memberNames: Record<string, string> = {}
  for (const m of members) if (involved.has(m.id)) memberNames[m.id] = m.fullName

  return <TrainingScreen initialExercises={exercises} initialFeedback={feedback} memberNames={memberNames} />
}
