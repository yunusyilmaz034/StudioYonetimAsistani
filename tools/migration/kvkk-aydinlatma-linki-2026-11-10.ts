import { initializeApp } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'

// KVKK — AYDINLATMA LİNKİ (owner, 2026-11-10: "önerilerine katılıyorum").
// WhatsApp/Instagram'da bir sohbetin İLK cevabının altına bir kez aydınlatma linki eklenir; adres stüdyonun
// verisidir. Yalnız `settings/ai.privacyNoticeUrl` yazılır; başka alana dokunmaz.
//   pnpm tsx tools/migration/kvkk-aydinlatma-linki-2026-11-10.ts            (kuru çalışma)
//   pnpm tsx tools/migration/kvkk-aydinlatma-linki-2026-11-10.ts --apply
const STUDIO = 'retro'
const URL = 'https://panel.pilatesfitnessbyisil.com/kvkk'

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply')
  initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID ?? 'studio-yonetim-prod' })
  const ref = getFirestore().doc(`studios/${STUDIO}/settings/ai`)
  const before = (await ref.get()).get('privacyNoticeUrl') ?? null
  console.log(apply ? '── UYGULANIYOR ──' : '── KURU ÇALIŞMA ──')
  console.log(`Aydınlatma linki: ${before ?? '(yok)'} → ${URL}`)
  if (apply) {
    await ref.set(
      { privacyNoticeUrl: URL, updatedAt: Timestamp.now(), updatedBy: { type: 'migration', id: 'kvkk-aydinlatma-linki-2026-11-10' } },
      { merge: true },
    )
    console.log('✓ yazıldı')
  }
  process.exit(0)
}
void main()
