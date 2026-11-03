import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

// IG-4a — STÜDYONUN REKLAM HESABI (owner, 2026-11-04).
//
//   pnpm tsx tools/migration/ig4a-reklam-hesabi-2026-11-04.ts            (kuru çalışma)
//   pnpm tsx tools/migration/ig4a-reklam-hesabi-2026-11-04.ts --apply
//
// Owner'ın onayıyla açılan işletme reklam hesabı (Işıl'ın kişisel hesabı işletmeye taşınmadı — taşıma geri
// alınamazdı). Gece 03:30 `adsInsightsSync` yalnızca bu hesabı OKUR. Veri, kod değil: başka bir stüdyo
// kendi hesabını aynı alana yazar.

const STUDIO = 'retro'
const AD_ACCOUNT = 'act_964285176326500' // "Pilates Fitness By Işıl", TRY, Europe/Istanbul

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply')
  initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID ?? 'studio-yonetim-prod' })
  const ref = getFirestore().doc(`studios/${STUDIO}/settings/ads`)
  const before = (await ref.get()).get('adAccountId') ?? '(yok)'
  console.log(apply ? '── UYGULANIYOR ──' : '── KURU ÇALIŞMA (hiçbir şey yazılmaz) ──')
  console.log(`adAccountId: ${before}  →  ${AD_ACCOUNT}`)
  if (!apply) {
    console.log('\nUygulamak için --apply')
    process.exit(0)
  }
  await ref.set({ adAccountId: AD_ACCOUNT }, { merge: true })
  console.log('✓ yazıldı')
  process.exit(0)
}

void main()
