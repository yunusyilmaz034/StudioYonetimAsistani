import {
  getMyActiveProgramAction,
  listMyFeedbackAction,
  listMyMeasurementsAction,
  listMyPhotosAction,
  listMyProgramGuidesAction,
  listMyProgramsAction,
} from '@/server/actions/training'

import { PortalTrainingScreen } from './training-screen'

// The member's TRAINING home (Plus Phase 7). Her active programme, her progress (measurements +
// the photos her trainer chose to share), and the per-exercise feedback loop. Every read is scoped
// to her verified session inside the action — there is no memberId parameter to forge.
export default async function PortalTrainingPage() {
  const [active, programs, measurements, feedback, photos, guides] = await Promise.all([
    getMyActiveProgramAction(),
    listMyProgramsAction(),
    listMyMeasurementsAction(),
    listMyFeedbackAction(),
    listMyPhotosAction(),
    listMyProgramGuidesAction(),
  ])

  return (
    <PortalTrainingScreen
      active={active}
      programs={programs}
      measurements={measurements}
      feedback={feedback}
      photos={photos}
      guides={guides}
    />
  )
}
