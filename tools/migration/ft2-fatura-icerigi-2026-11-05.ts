import { initializeApp } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'

// FT-2 — FATURA İÇERİĞİ (owner, 2026-11-05): hizmet satırı yalnız kategori ("pilates 8 ders almış ama sadece biz
// pilates yazacaz … fitnessta da sadece fitness"), fiş sınırı 12.000 ₺, alıcı adresi yalnız il/ilçe: Kocaeli / Çayırova.
// Yalnız bu alanlar yazılır (merge); KDV %20 ve diğerleri olduğu gibi kalır.
//   pnpm tsx tools/migration/ft2-fatura-icerigi-2026-11-05.ts            (kuru çalışma)
//   pnpm tsx tools/migration/ft2-fatura-icerigi-2026-11-05.ts --apply
const STUDIO = 'retro'
const PATCH = {
  serviceLineByCategory: { pilates_group: 'Pilates', fitness: 'Fitness', private: 'Özel Ders' },
  serviceLine: 'Hizmet bedeli',
  receiptLimitKurus: 1_200_000,
  buyerCity: 'Kocaeli',
  buyerDistrict: 'Çayırova',
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply')
  initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID ?? 'studio-yonetim-prod' })
  const ref = getFirestore().doc(`studios/${STUDIO}/settings/invoicing`)
  const before = (await ref.get()).data() ?? {}
  console.log(apply ? '── UYGULANIYOR ──' : '── KURU ÇALIŞMA ──')
  for (const [k, v] of Object.entries(PATCH)) console.log(`${k}: ${JSON.stringify(before[k] ?? null)} → ${JSON.stringify(v)}`)
  console.log(`(dokunulmayan) vatRatePercent: ${JSON.stringify(before.vatRatePercent ?? null)}`)
  if (apply) {
    await ref.set({ ...PATCH, updatedAt: Timestamp.now(), updatedBy: { type: 'migration', id: 'ft2-fatura-icerigi-2026-11-05' } }, { merge: true })
    console.log('✓ yazıldı')
  }
  process.exit(0)
}
void main()
