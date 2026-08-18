import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

// AĞUSTOS 2026 FITNESS KAMPANYASI, İKİNCİ YARISI — the cash prices and the AI's campaign note.
//
//   pnpm tsx tools/migration/campaign-2026-08-cash-prices.ts            (dry run)
//   pnpm tsx tools/migration/campaign-2026-08-cash-prices.ts --apply
//
// The first script set the CARD prices and lifted the instalment cap to six. It could not set the
// cash prices, because there was nowhere to put them: the model derived card from cash with one rule
// per category, and this campaign's gaps are neither a constant amount (1.000 / 1.250 / 2.500) nor a
// constant percentage (11.8 / 9.8 / 12.8 %). `product.cashPriceInKurus` now exists for exactly this.
//
// Written straight to the product document rather than through updateProduct: this is a price
// correction on three known rows, and routing it through the domain would require re-sending every
// other field of each product from a script that does not own them.
//
// The campaign NOTE carries no prices on purpose. The assistant already reads the live catalogue; a
// number repeated here would be a second source of truth that goes stale the day the owner edits a
// price and forgets this file exists.

const STUDIO = 'retro'

const CASH: readonly { id: string; name: string; cashKurus: number }[] = [
  { id: 'prd_01KXJD2CW08CNP08KJRSW34DRR', name: 'Fitness - 3 Aylık', cashKurus: 850_000 },
  { id: 'prd_01KXJD2D1EMQRC6C0RD777VG2Y', name: 'Fitness - 6 Aylık', cashKurus: 1_275_000 },
  { id: 'prd_01KZBDCZYNYPBDZXSNRVGGPXJE', name: 'Fitness - 12 Aylık', cashKurus: 1_950_000 },
]

const CAMPAIGN = [
  'Şu an Fitness paketlerinde kampanya var. Fiyat konuşulan her sohbette bunu kullan.',
  '',
  '- ÖNCELİK: 12 Aylık Fitness paketi. Önce onu, gerekçesiyle anlat: aylık maliyeti en düşük paket bu ve ödeme kolaylığı da burada.',
  '- 12 Aylık\'ta kredi kartına PEŞİN FİYATINA 3 TAKSİT yapılıyor: müşteri vade farkı ödemiyor, fiyat değişmiyor. Bunu net söyle, en güçlü argüman bu.',
  '- 3 Aylık ve 6 Aylık\'ta kredi kartına 6 taksite kadar imkân var; bu ikisinde vade farkını ödeme kuruluşu yansıtıyor, stüdyo belirlemiyor. Taksitli tutarı sorarlarsa rakam verme, "ödeme ekranında net tutarı görürsünüz" de.',
  '- Nakit ve kredi kartı fiyatları FARKLI. İkisini de olduğu gibi söyle; nakit fiyatını kartla ödeyecek birine verme.',
  '- Kontenjan sınırlı, kayıtlar sırayla ilerliyor. Bunu bir kez, sakin ve nazik söyle — baskı kurma, her mesajda tekrarlama.',
  '- Stüdyoya gelemeyen için uzaktan kayıt var: yetkilimiz ödeme linki gönderiyor, müşteri kartıyla ödüyor ve üyeliği başlıyor. İsteyene bunu teklif et, sonra yetkiliye devret.',
  '- Kampanya Pilates ve hibrit paketleri KAPSAMIYOR; oralarda tek fiyat geçerli.',
].join('\n')

const tl = (k: number) => `${(k / 100).toLocaleString('tr-TR')} ₺`

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply')
  initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID ?? 'studio-yonetim-prod' })
  const db = getFirestore()

  console.log(apply ? '── UYGULANIYOR ──\n' : '── KURU ÇALIŞMA (hiçbir şey yazılmaz) ──\n')

  for (const p of CASH) {
    const ref = db.doc(`studios/${STUDIO}/products/${p.id}`)
    const snap = await ref.get()
    if (!snap.exists) {
      console.log(`✗ ${p.name}: ürün bulunamadı`)
      continue
    }
    const card = Number(snap.get('priceInKurus'))
    const current = snap.get('cashPriceInKurus') as number | undefined
    if (p.cashKurus >= card) {
      // A cash price at or above the card price is a typo, not a campaign. Refuse, never clamp.
      console.log(`✗ ${p.name}: nakit ${tl(p.cashKurus)} ≥ kart ${tl(card)} — yazılmadı`)
      continue
    }
    console.log(
      `${p.name.padEnd(20)} kart ${tl(card).padStart(11)} · nakit ${String(current == null ? '—' : tl(current)).padStart(11)} → ${tl(p.cashKurus).padStart(11)}`,
    )
    if (apply) await ref.update({ cashPriceInKurus: p.cashKurus, updatedAt: Date.now() })
  }

  const aiRef = db.doc(`studios/${STUDIO}/settings/ai`)
  const existing = String((await aiRef.get()).get('campaign') ?? '')
  console.log(`\nAI kampanya notu    : ${existing ? `${existing.length} karakter (üzerine yazılıyor)` : 'boş'} → ${CAMPAIGN.length} karakter`)
  if (apply) await aiRef.set({ campaign: CAMPAIGN }, { merge: true })

  console.log(apply ? '\nBitti.' : '\nUygulamak için --apply')
  process.exit(0)
}

void main()
