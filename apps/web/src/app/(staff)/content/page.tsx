import { requirePageAccess } from '@/server/auth'

import { ContentScreen } from './content-screen'

// IG-2a — "İçerik": the week's Instagram plan. The AI proposes, the studio films, the owner approves.
// Nothing on this screen publishes (that is IG-2b, behind the approval event).
export default async function ContentPage() {
  await requirePageAccess('/content')
  return <ContentScreen />
}
