import { FirestoreFinanceRepository, cancelSale, systemClock, voidPayment, type TenantContext } from '@studio/core'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

// NESLİHAN EROĞLU — HİÇ GİRMEMİŞ BİR PARA DEFTERDE DURUYORDU (owner teyidi, 2026-09-04).
//
//   pnpm tsx tools/migration/fix-neslihan-hayalet-odeme-2026-09.ts
//   pnpm tsx tools/migration/fix-neslihan-hayalet-odeme-2026-09.ts --apply
//
// ── NE OLDU ─────────────────────────────────────────────────────────────────────────────────
//
//   27.08 14:52  paket satıldı 8.500 ₺ · 9.500 ₺ tahsilat yazıldı (credit_card)
//   31.08 11:20  paket İPTAL edildi · sebep "iptal etti" · iade YOK
//
// Owner: *"Neslihan hiç ödememiş aslında, kasada yok yani, yanlış yapılmış."* Yani 9.500 ₺'lik
// tahsilat karşılıksızdı — para hiç girmedi.
//
// ── NEDEN "KASA ÇIKIŞI" DEĞİL ───────────────────────────────────────────────────────────────
//
// Owner "kasadan düş" dedi ve niyeti doğru, ama işlem başka: **kasa çıkışı "para ÇIKTI" demektir.**
// Burada para hiç GİRMEDİ. Çıkış yazmak, olmamış bir girişi olmuş sayıp üstüne olmamış bir çıkış
// eklemek olurdu — iki uydurma hareket, ve ikisi de raporlarda görünürdü.
//
// Doğrusu ödemenin İPTALİ (`voided`): kayıt silinmez, sebebiyle durur ve ciroya girmez (I-31).
// Kasa zaten etkilenmiyor — ödeme `credit_card` ve kasasız kayıtlıydı (bu stüdyoda POS kasası hiç
// tanımlı değil).
//
// SATIŞ DA İPTAL EDİLİYOR. Yalnızca ödemeyi iptal etseydik satış 8.500 ₺ AÇIK BORÇ olarak kalırdı —
// yani vazgeçtiği ve hiç ödemediği bir paket için Neslihan borçlu görünürdü. Paket 31 Ağustos'ta
// zaten iptal edilmişti; satışın da onunla gitmesi gerekiyordu.

const STUDIO = 'retro'
const APPLY = process.argv.includes('--apply')
const SALE = 'sal_01M11H06EHAA1R1JW3D8BTCZ4V'
const PAYMENT = 'pay_01M11H06EHAA1R1JW3D8BTCZ4V'
const REASON =
  'Tahsilat karşılıksız: para hiç girmemiş, kayıt yanlış yapılmış. Paket 31.08’de zaten iptal edilmişti (owner teyidi, 2026-09-04).'

const tl = (k: number) => `${(k / 100).toLocaleString('tr-TR')} ₺`

async function main(): Promise<void> {
  initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID ?? 'studio-yonetim-prod' })
  const db = getFirestore()
  const ctx = {
    studioId: STUDIO,
    actor: { type: 'platform_admin', id: 'migration:fix-neslihan-hayalet-odeme-2026-09' },
    branchIds: ['mutlukent'],
    correlationId: 'fix-neslihan-hayalet-odeme-2026-09',
    source: 'migration',
    role: 'platform_admin',
  } as unknown as TenantContext
  const fin = { repo: new FirestoreFinanceRepository(db), clock: systemClock }

  const s = await db.doc(`studios/${STUDIO}/sales/${SALE}`).get()
  const p = await db.doc(`studios/${STUDIO}/payments/${PAYMENT}`).get()
  console.log(APPLY ? '── UYGULANIYOR ──\n' : '── KURU ÇALIŞMA ──\n')
  console.log(`  satış : ${s.exists ? `${tl(s.get('total.amount') ?? 0)} · ${s.get('status')}` : 'YOK'}`)
  console.log(`  ödeme : ${p.exists ? `${tl(p.get('amount.amount') ?? 0)} · ${p.get('method')} · iptal ${p.get('voided')}` : 'YOK'}`)

  if (!p.exists || p.get('voided') === true) { console.log('\nDUR: ödeme yok ya da zaten iptal.'); return }
  if (!s.exists || s.get('status') === 'cancelled') { console.log('\nDUR: satış yok ya da zaten iptal.'); return }
  if (!APPLY) { console.log('\n(uygulamak için --apply)'); return }

  const v = await voidPayment(fin, ctx, { paymentId: PAYMENT, reason: REASON })
  if (!v.ok) { console.error('ÖDEME İPTALİ BAŞARISIZ:', v.error); return }
  console.log('  ✓ karşılıksız tahsilat iptal edildi')

  const c = await cancelSale(fin, ctx, { saleId: SALE, reason: REASON })
  if (!c.ok) { console.error('SATIŞ İPTALİ BAŞARISIZ:', c.error); return }
  console.log('  ✓ satış iptal edildi — vazgeçtiği paket için borçlu görünmeyecek')
}

void main()
