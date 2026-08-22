import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

// REFORMER PILATES KAMPANYA FİYATLARI (owner, 2026-08-22).
//
//   pnpm tsx tools/migration/pilates-8-cash-price-2026-08.ts            (kuru çalışma)
//   pnpm tsx tools/migration/pilates-8-cash-price-2026-08.ts --apply
//
// Owner: 8 Ders → nakit 4.200 / kart 5.000 · 16 Ders → nakit 7.800 / kart 8.600.
// Model fitness tarafındakiyle aynı: `priceInKurus` KART fiyatı, `cashPriceInKurus` nakit.
// 16 Ders'te kart fiyatı da değişiyor (8.500 → 8.600) — bu yüzden ikisi de yazılıyor.
//
// Fiyat yalnızca ürün belgesine yazılıyor; asistan katalogdan okuyor (`whatsapp-webhook.ts`
// → `productPrices()`), yani rakamı ikinci bir yere yazmak iki doğru üretirdi.
//
// İKİNCİ DEĞİŞİKLİK, ve asıl tuzak: kampanya notunun son satırı "Kampanya Pilates ve hibrit
// paketleri KAPSAMIYOR; oralarda tek fiyat geçerli" diyor. Bu satır bugünden itibaren YANLIŞ —
// asistan katalogdan iki fiyat okuyup, aynı cümlede "pilateste tek fiyat" derdi. Fiyatı düzeltip
// notu bırakmak, düzeltmemekten kötü olurdu.

const STUDIO = 'retro'

const PRICES: readonly { name: string; cashKurus: number; cardKurus: number }[] = [
  { name: 'Reformer Pilates - 8 Ders', cashKurus: 420_000, cardKurus: 500_000 },
  { name: 'Reformer Pilates - 16 Ders', cashKurus: 780_000, cardKurus: 860_000 },
]

const OLD_LINE = '- Kampanya Pilates ve hibrit paketleri KAPSAMIYOR; oralarda tek fiyat geçerli.'
const NEW_LINE = [
  '- Reformer Pilates 8 ve 16 Ders paketlerinde de nakit ve kart fiyatı FARKLI; katalogdaki iki fiyatı da olduğu gibi söyle.',
  '- Diğer Pilates paketlerinde ve hibrit paketlerde tek fiyat geçerli.',
].join('\n')

const tl = (k: number) => `${(k / 100).toLocaleString('tr-TR')} ₺`

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply')
  initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID ?? 'studio-yonetim-prod' })
  const db = getFirestore()

  console.log(apply ? '── UYGULANIYOR ──\n' : '── KURU ÇALIŞMA (hiçbir şey yazılmaz) ──\n')

  const writes: { ref: FirebaseFirestore.DocumentReference; patch: Record<string, number> }[] = []

  for (const p of PRICES) {
    const found = await db.collection(`studios/${STUDIO}/products`).where('name', '==', p.name).get()
    if (found.size !== 1) {
      console.log(`✗ "${p.name}" için ${found.size} ürün bulundu, 1 bekleniyordu. Durduruldu.`)
      process.exit(1)
    }
    const doc = found.docs[0]!
    const card = Number(doc.get('priceInKurus'))
    const cash = doc.get('cashPriceInKurus') as number | undefined

    // Nakit fiyat karttan büyük olamaz: olursa asistan "nakit daha pahalı" der ve kimse inanmaz.
    if (p.cashKurus >= p.cardKurus) {
      console.log(`\n✗ ${p.name}: nakit ${tl(p.cashKurus)} < kart ${tl(p.cardKurus)} olmalı. Durduruldu.`)
      process.exit(1)
    }

    console.log(`${p.name}  (${doc.id})`)
    console.log(`  kart  : ${tl(card)}${card === p.cardKurus ? '  (değişmiyor)' : `  →  ${tl(p.cardKurus)}`}`)
    console.log(`  nakit : ${cash == null ? '— (tanımsız)' : tl(cash)}  →  ${tl(p.cashKurus)}`)

    writes.push({ ref: doc.ref, patch: { priceInKurus: p.cardKurus, cashPriceInKurus: p.cashKurus } })
  }

  const aiRef = db.doc(`studios/${STUDIO}/settings/ai`)
  const campaign = String((await aiRef.get()).get('campaign') ?? '')
  const hasOld = campaign.includes(OLD_LINE)
  console.log(`\nkampanya notu: ${hasOld ? 'eski satır bulundu, düzeltilecek' : '⚠ eski satır YOK — elle bak'}`)
  if (hasOld) {
    console.log(`  ${OLD_LINE}`)
    console.log('  →')
    for (const l of NEW_LINE.split('\n')) console.log(`  ${l}`)
  }

  if (!apply) {
    console.log('\nUygulamak için --apply')
    process.exit(0)
  }

  for (const w of writes) await w.ref.update(w.patch)
  if (hasOld) await aiRef.update({ campaign: campaign.replace(OLD_LINE, NEW_LINE) })

  console.log('\n✓ Yazıldı. Asistan artık iki fiyatı da söyleyecek.')
  process.exit(0)
}

void main()
