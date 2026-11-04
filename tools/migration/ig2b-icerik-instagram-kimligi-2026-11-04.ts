import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

// IG-2b — İÇERİĞİN YAYINLANACAĞI INSTAGRAM HESABI (owner, 2026-11-04).
//   pnpm tsx tools/migration/ig2b-icerik-instagram-kimligi-2026-11-04.ts            (kuru çalışma)
//   pnpm tsx tools/migration/ig2b-icerik-instagram-kimligi-2026-11-04.ts --apply
// Yayıncı (functions: contentPublisher) `settings/content.igUserId`ten okur; yoksa hiçbir şey yayınlamaz.
const STUDIO = 'retro'
const IG_USER_ID = '17841458516080649' // @pilatesbyisil

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply')
  initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID ?? 'studio-yonetim-prod' })
  const ref = getFirestore().doc(`studios/${STUDIO}/settings/content`)
  const before = (await ref.get()).get('igUserId') ?? '(yok)'
  console.log(apply ? '── UYGULANIYOR ──' : '── KURU ÇALIŞMA ──')
  console.log(`igUserId: ${before}  →  ${IG_USER_ID}`)
  if (apply) {
    await ref.set({ igUserId: IG_USER_ID }, { merge: true })
    console.log('✓ yazıldı')
  }
  process.exit(0)
}
void main()
