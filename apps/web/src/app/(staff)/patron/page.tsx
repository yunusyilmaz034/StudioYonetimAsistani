import { requirePageAccess } from '@/server/auth'

import { PatronScreen } from './patron-screen'

// Faz 2 — "Patron Asistanı". The owner's conversational, business-aware assistant. Owner-only.
export default async function PatronPage() {
  await requirePageAccess('/patron')
  return <PatronScreen />
}
