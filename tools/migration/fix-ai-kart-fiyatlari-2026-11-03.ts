import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

// AI DA KART FİYATINI SÖYLER (owner, 2026-11-03).
//
//   pnpm tsx tools/migration/fix-ai-kart-fiyatlari-2026-11-03.ts            (kuru çalışma)
//   pnpm tsx tools/migration/fix-ai-kart-fiyatlari-2026-11-03.ts --apply
//
// Owner: *"ai da web sitesi ve üye uygulaması ile aynı fiyatları söylesin ayrım olmasın"*.
// 23 Ekim'de (OR-129) AI, Işıl'ın elle yazdığı listeyi söylüyordu (3 Aylık 8.500) ve site/uygulama kart
// fiyatını (9.500) — reklamdan gelen biri iki rakam görüyordu. Bugünden itibaren AI'ın listesi kataloğun
// KART fiyatıyla aynı. Yalnız rakamlar değişir; listenin metni, kuralları ve hitapları aynen kalır.
//
// Hamile Pilatesi katalogda ayrı ürün değil; AI listesinde PT ile aynı rakamlardı — aynı kalmaya devam eder.

const STUDIO = 'retro'

const SWAPS: readonly [from: string, to: string][] = [
  ['- 3 Aylık Üyelik: 8.500 TL', '- 3 Aylık Üyelik: 9.500 TL'],
  ['- 6 Aylık Üyelik: 13.000 TL', '- 6 Aylık Üyelik: 14.000 TL'],
  ['- 12 Aylık Üyelik: 19.500 TL', '- 12 Aylık Üyelik: 22.000 TL'],
  // PT ve Hamile Pilatesi bölümleri aynı iki satırı taşıyor: ikisi de değişir (iki kez geçmesi beklenir).
  ['- 8 Ders: 12.000 TL', '- 8 Ders: 13.200 TL'],
  ['- 16 Ders: 20.000 TL', '- 16 Ders: 22.000 TL'],
]
const EXPECTED_COUNT: Record<string, number> = { '- 8 Ders: 12.000 TL': 2, '- 16 Ders: 20.000 TL': 2 }

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply')
  initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID ?? 'studio-yonetim-prod' })
  const db = getFirestore()
  console.log(apply ? '── UYGULANIYOR ──\n' : '── KURU ÇALIŞMA (hiçbir şey yazılmaz) ──\n')

  const ref = db.doc(`studios/${STUDIO}/settings/ai`)
  let text = String((await ref.get()).get('priceList') ?? '')
  for (const [from, to] of SWAPS) {
    const n = text.split(from).length - 1
    const want = EXPECTED_COUNT[from] ?? 1
    if (n !== want) {
      console.error(`DUR: "${from}" ${n} kez geçiyor, ${want} bekleniyordu.`)
      process.exit(1)
    }
    console.log(`${from}  →  ${to}${n > 1 ? `  (${n} yerde)` : ''}`)
    text = text.split(from).join(to)
  }
  if (!apply) {
    console.log('\nUygulamak için --apply')
    process.exit(0)
  }
  await ref.set({ priceList: text }, { merge: true })
  console.log('\n✓ AI fiyat listesi kart fiyatlarıyla aynı.')
  process.exit(0)
}

void main()
