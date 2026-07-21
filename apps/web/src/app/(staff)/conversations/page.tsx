import { requirePageAccess } from '@/server/auth'

import { ConversationsScreen } from './conversations-screen'

// Faz 2 — "Sohbetler". The full-screen view of the WhatsApp AI receptionist: every conversation (live +
// history), what the AI is saying, who it's talking to, and a score. Owner + reception; the collection
// is server-only, reached through the conversation actions.
export default async function ConversationsPage() {
  await requirePageAccess('/conversations')
  return <ConversationsScreen />
}
