import { initializeApp } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'

// FT-2 — KDV ORANI %20 (owner, 2026-11-05: "bizim kdv oranımız bellidir mesela %20 ile çalışıyoruz").
// Yalnız `settings/invoicing.vatRatePercent` yazılır; başka alana dokunmaz. e-Arşiv yine Paraşüt bağlanınca açılır.
//   pnpm tsx tools/migration/ft2-kdv-yuzde-20-2026-11-05.ts            (kuru çalışma)
//   pnpm tsx tools/migration/ft2-kdv-yuzde-20-2026-11-05.ts --apply
const STUDIO = 'retro'
const VAT = 20

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply')
  initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID ?? 'studio-yonetim-prod' })
  const ref = getFirestore().doc(`studios/${STUDIO}/settings/invoicing`)
  const before = (await ref.get()).get('vatRatePercent') ?? null
  console.log(apply ? '── UYGULANIYOR ──' : '── KURU ÇALIŞMA ──')
  console.log(`KDV: ${before === null ? '(yok)' : `%${before}`} → %${VAT}`)
  if (apply) {
    await ref.set(
      { vatRatePercent: VAT, updatedAt: Timestamp.now(), updatedBy: { type: 'migration', id: 'ft2-kdv-2026-11-05' } },
      { merge: true },
    )
    console.log('✓ yazıldı')
  }
  process.exit(0)
}
void main()
