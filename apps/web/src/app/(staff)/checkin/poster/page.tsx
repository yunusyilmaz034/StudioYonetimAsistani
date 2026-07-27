import { requirePageAccess } from '@/server/auth'
import { posterTokenAction } from '@/server/actions/qr'

import { PosterSheet } from './poster-sheet'

// THE PRINTED CHECK-IN SHEET (owner, 2026-07-27).
//
// The studio has no tablet at reception, and buying one before the studio needs one is the wrong
// order of spending. So the QR comes off a screen and onto A4: reception prints this each morning,
// tapes it to the desk, and members scan it with the phones they are already holding.
//
// The trade this makes is written out in `posterToken` (server/actions/qr.ts): a day-long, shared,
// signed code instead of a sixty-second single-use one. The reason it is acceptable here and nowhere
// else in this system: the sheet identifies the STUDIO and the DAY — never a person. Whoever scans it
// still has to be signed in as herself, so a photograph of the sheet lets someone mark her OWN
// attendance from home; it can never mark anyone else's, and it reveals nothing about who came.
//
// Reprinting is free and idempotent: the same day yields the same code, so a second copy for the
// upstairs studio is just another print.

export default async function PosterPage() {
  await requirePageAccess('/checkin')
  const res = await posterTokenAction()

  if (!res.ok) {
    return (
      <main className="mx-auto max-w-2xl p-6">
        <p className="text-sm text-danger">
          Bu hesap bir şubeye bağlı değil, günlük kod üretilemedi. Ayarlar → Şubeler bölümünden
          kontrol edin.
        </p>
      </main>
    )
  }

  return (
    <PosterSheet
      studioName={res.value.studioName}
      token={res.value.token}
      studioId={res.value.studioId}
      day={res.value.day}
      validUntil={res.value.validUntil}
    />
  )
}
