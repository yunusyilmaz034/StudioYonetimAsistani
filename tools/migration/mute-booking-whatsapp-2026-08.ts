// Rezervasyon ve iptal bildirimleri WhatsApp'tan gitmesin (owner, 2026-08-31).
//
//   pnpm tsx tools/migration/mute-booking-whatsapp-2026-08.ts            (kuru çalışma)
//   pnpm tsx tools/migration/mute-booking-whatsapp-2026-08.ts --apply
//
// WHY. *"Rezervasyon yapanlara otomatik wp mesajı gidiyor ya, gitmesin; iptalde de gitmesin."*
// The live log shows it: 32 `booking_confirmed` WhatsApps in the last 300 notifications, plus the
// cancellations. The member made the booking herself, in the app, seconds earlier — the WhatsApp
// tells her something she has just done, and it costs a Meta conversation each time.
//
// WHAT IS NOT BEING DONE, and why it matters:
//
//   · The studio's WhatsApp channel stays ON. Turning it off studio-wide would also silence the
//     messages that earn their keep — a package about to expire, a payment received, credits running
//     low. The blunt lever was the only one that existed until today.
//   · The templates stay ACTIVE. Deactivating them would remove the IN-APP notification too, and
//     that is the member's own record of her booking. Hers, not ours to delete.
//
// So the two templates are muted on WhatsApp specifically, using the per-template channel mute added
// today. E-mail and in-app are untouched: she still sees it in the app, and still gets the e-mail if
// she has one and wants it.
//
// This is the same write the owner can now make from Bildirim Merkezi → şablon → "gitmesin" — done
// here only so it takes effect tonight rather than after the deploy.

import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

import { TEMPLATES as SEED } from '@studio/core'

const STUDIO = 'retro'
const TEMPLATES = ['booking_confirmed', 'booking_cancelled'] as const
const MUTE = ['whatsapp']

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply')
  initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID ?? 'studio-yonetim-prod' })
  const db = getFirestore()

  console.log(apply ? '── UYGULANIYOR ──\n' : '── KURU ÇALIŞMA (hiçbir şey yazılmaz) ──\n')

  for (const id of TEMPLATES) {
    const ref = db.doc(`studios/${STUDIO}/notificationTemplates/${id}`)
    const cur = (await ref.get()).data() as Record<string, unknown> | undefined
    const already = ((cur?.mutedChannels as string[] | undefined) ?? []).includes('whatsapp')
    console.log(`${id.padEnd(20)} override=${cur ? `v${String(cur.version)}` : 'yok (kod tohumu)'} · whatsapp ${already ? 'ZATEN KAPALI' : 'kapatılacak'}`)
    if (!apply || already) continue

    // An override document must be COMPLETE — the pipeline reads it INSTEAD of the code seed, not on
    // top of it. Writing `{ mutedChannels }` alone would produce a template with no body, and every
    // send would then be refused at render. So a studio with no override yet gets the full CODE SEED
    // plus the mute, which is byte-for-byte what the panel writes when the owner presses Kaydet.
    const seed = SEED[id]
    if (!seed) {
      console.log(`  ⚠ ${id}: kod tohumunda yok — atlanıyor.`)
      continue
    }
    const base = cur ?? (seed as unknown as Record<string, unknown>)
    await ref.set(
      { ...base, mutedChannels: MUTE, version: Number(base.version ?? 1) + 1, updatedAt: Date.now() },
      { merge: false },
    )
    console.log(`  ✓ ${id}: WhatsApp kapatıldı (uygulama içi ve e-posta devam ediyor)`)
  }

  if (!apply) console.log('\n(uygulamak için --apply)')
}

void main().catch((e: unknown) => {
  console.error(e)
  process.exitCode = 1
})
