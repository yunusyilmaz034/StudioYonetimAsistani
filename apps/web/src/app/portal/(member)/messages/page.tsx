import { myInboxAction, myPrefsAction } from '@/server/actions/notifications'

import { MessagesScreen } from './messages-screen'

// Her inbox — the one channel she cannot switch off, because it is not a message: it is her RECORD
// of what happened to her account.
export default async function MessagesPage() {
  const [inbox, prefs] = await Promise.all([myInboxAction(), myPrefsAction()])
  return <MessagesScreen inbox={inbox} prefs={prefs} />
}
