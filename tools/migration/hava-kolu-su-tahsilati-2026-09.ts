import { FirestoreFinanceRepository, collect, money, systemClock, type MemberId, type BranchId, type TenantContext } from '@studio/core'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

// HAVA KOLU — 20 ₺'LİK SU ÖDENDİ, DEFTERDE ÖDENMEMİŞ GÖRÜNÜYORDU (owner teyidi, 2026-09-09).
//
//   pnpm tsx tools/migration/hava-kolu-su-tahsilati-2026-09.ts
//   pnpm tsx tools/migration/hava-kolu-su-tahsilati-2026-09.ts --apply
//
// ── NE OLDU ─────────────────────────────────────────────────────────────────────────────────
//
//   07.09 17:43  1 su, 20 ₺, üyenin hesabına yazıldı (ödeme yok — bu ekranın normal işleyişi)
//   09.09 19:03  kartla 200 ₺ çekildi, 160 ₺ cüzdana yüklendi
//
// Cüzdan yüklemesi bir TAHSİLAT DEĞİL, bakiye hareketi: olayda `paymentId: null`, hiçbir satışa
// bağlanmıyor. Dolayısıyla para stüdyoya girdi ama suyun borcuna hiç dokunmadı ve 20 ₺ açık kaldı.
//
// Owner: *"borcu sil, ama ödedi işte, işle onu da — ama cüzdanındakini şimdi çekme."*
//
// ── NEDEN SİLİNMİYOR, TAHSİLAT YAZILIYOR ────────────────────────────────────────────────────
//
// Borcu "silmek" satışı iptal etmek olurdu, ve o "su verilmedi" demektir. Su verildi ve parası
// alındı. Olan şeyi yazmak, olmamış saymaktan hem daha doğru hem de ciroyu doğru tutuyor:
// 20 ₺ gerçek bir gelirdir ve raporda görünmelidir.
//
// ── NEDEN CÜZDANDAN DEĞİL, KARTTAN ──────────────────────────────────────────────────────────
//
// Owner cüzdana dokunulmamasını istedi, ve gerekçe defterde de doğru: kadın kartla ödedi. Cüzdandan
// düşmek, kartla giren parayı cüzdandan çıkmış gibi göstermek olurdu — cüzdan 140'a inerdi ve
// kartla gelen 20 ₺ hiçbir yere yazılmamış olarak kalırdı. `credit_card` yazmak ikisini birden
// düzeltiyor: borç kapanıyor, gelir görünüyor, cüzdan 160 ₺'de kalıyor.
//
// KASA ETKİLENMİYOR: bu stüdyoda POS kasası tanımlı değil, ödeme kasasız kaydediliyor.

const STUDIO = 'retro'
const APPLY = process.argv.includes('--apply')
const MEMBER = 'mem_01KZ3DV0GWQ5PDZ6T2MHQZT9S2'
const SALE = 'sal_01M1Y55PB5TWGR9M3V7E9TPJJ7'
const tl = (k: number) => `${(k / 100).toLocaleString('tr-TR')} ₺`

async function main(): Promise<void> {
  initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID ?? 'studio-yonetim-prod' })
  const db = getFirestore()
  const ctx = {
    studioId: STUDIO,
    // Aktör bir PRENSİP (#5): bu satırı bir script yazdı, ve öyle görünüyor. Owner'ın kimliğini
    // ödünç almak, defterde olmamış bir masa başı işlemi gibi durur.
    actor: { type: 'platform_admin', id: 'migration:hava-kolu-su-tahsilati-2026-09' },
    branchIds: ['mutlukent'],
    correlationId: 'hava-kolu-su-tahsilati-2026-09',
    source: 'migration',
    role: 'platform_admin',
  } as unknown as TenantContext
  const fin = { repo: new FirestoreFinanceRepository(db), clock: systemClock }

  const s = await db.doc(`studios/${STUDIO}/sales/${SALE}`).get()
  if (!s.exists) { console.log('DUR: satış bulunamadı.'); return }
  const toplam = Number(s.get('total.amount') ?? 0)
  const odenen = Number(s.get('paid.amount') ?? 0)
  const kalan = toplam - odenen
  console.log(APPLY ? '── UYGULANIYOR ──\n' : '── KURU ÇALIŞMA ──\n')
  console.log(`  satış : ${s.get('lines')?.[0]?.description} · ${tl(toplam)} · ödenen ${tl(odenen)} · durum ${s.get('status')}`)
  console.log(`  yazılacak tahsilat: ${tl(kalan)} · credit_card · yalnızca BU satışa`)

  // ZATEN KAPALIYSA DOKUNMA. Betik iki kez çalıştırılırsa ikinci bir 20 ₺ yazmamalı — üyeye
  // olmayan bir alacak açardı.
  if (kalan <= 0) { console.log('\nDUR: satışta kalan borç yok, yapılacak bir şey yok.'); return }
  if (!APPLY) { console.log('\n--apply ile çalıştırın.'); return }

  const r = await collect(fin, ctx, {
    paymentId: `pay_hava_kolu_su_2026_09_09`,
    memberId: MEMBER as MemberId,
    branchId: 'mutlukent' as BranchId,
    amount: money(kalan),
    method: 'credit_card',
    receivedAt: systemClock.now(),
    drawerId: null,
    giftCardCode: null,
    note: 'Su bedeli — 09.09 kartla alınan 200 ₺ içinde tahsil edildi (owner teyidi).',
    // HEDEF AÇIKÇA VERİLİYOR: en eski borca kendiliğinden dağılmasın. Bu para suyun parası.
    allocateTo: [{ saleId: SALE, amount: money(kalan), allocationId: 'alc_hava_kolu_su_2026_09_09' }],
    allowNoDrawer: true,
  })
  console.log(r.ok ? `\n✓ tahsilat yazıldı · eşleşmemiş kalan ${tl(r.value.unallocated)}` : `\n✗ REDDEDİLDİ: ${JSON.stringify(r.error)}`)
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1) })
