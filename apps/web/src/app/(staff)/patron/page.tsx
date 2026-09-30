import { requirePageAccess } from '@/server/auth'
import { reportPinIsDefault, reportsUnlocked } from '@/server/report-pin'
import { ReportPinGate } from '@/components/report-pin-gate'

import { PatronScreen } from './patron-screen'

// Faz 2 — "Patron Asistanı". The owner's conversational, business-aware assistant. Owner-only.
//
// PIN'li ([[OR-117]]): bu ekran rakamlarla KONUŞUYOR — cirosu, borcu, kimin kaç para ödediği tek
// bir soruyla dökülür. Raporları kilitleyip burayı açık bırakmak, arka kapıyı açık bırakmaktır.
export default async function PatronPage() {
  const ctx = await requirePageAccess('/patron')
  if (!(await reportsUnlocked(String(ctx.studioId), String(ctx.actor.id)))) {
    return <ReportPinGate varsayilan={await reportPinIsDefault(String(ctx.studioId))} />
  }
  return <PatronScreen />
}
