import { KapiScreen } from './screen'

// ── THE DOOR SCREEN ─────────────────────────────────────────────────────────────────────────
//
// A monitor at the turnstile. It shows a code as a QR; the member scans it with her app; the app
// asks the server whether the arm may turn. This page never decides anything — it draws.
//
// Deliberately its own route rather than part of the panel: it is opened once on a machine bolted
// to a wall and then never touched. No navigation, no session, no way to wander into the panel from
// it. What the corridor can see is a code and a first name, and nothing else.
export const metadata = { title: 'Giriş' }
export const dynamic = 'force-dynamic'

export default function Page() {
  return <KapiScreen />
}
