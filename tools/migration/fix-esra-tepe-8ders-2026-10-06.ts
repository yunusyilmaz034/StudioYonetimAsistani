import {
  adjustCredits,
  available,
  cancelSale,
  FirestoreEntitlementRepository,
  FirestoreFinanceRepository,
  instant,
  money,
  sell,
  systemClock,
  voidPayment,
  type EntitlementId,
  type MemberId,
  type TenantContext,
} from '@studio/core'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'

// ESRA TEPE — 24 DERS İPTAL, 8 DERS KALIYOR (owner onayı, 2026-10-06)
//
//   pnpm tsx tools/migration/fix-esra-tepe-8ders-2026-10-06.ts
//   pnpm tsx tools/migration/fix-esra-tepe-8ders-2026-10-06.ts --apply
//
// Owner: *"24 ders iptal olup 8 ders olacak ama bugüne kadar kullandığı kredileri geri vermiyoruz,
// onları 8 dersten düşeceğiz, var olan rezervasyonlarını ellemeyeceğiz. Sadece 8 ders parası aldık
// ve 8 ders paketi satmışız, bize borçlu da değil alacaklı da değil."* → *"31-08 olarak yine
// başlatacaksın paketi."*
// 6.800 ₺ farkı sorduğumda: **"11.000 ₺ hiç gelmedi"** — gerçek tahsilat 4.200 ₺.
//
// ── NEDEN YENİ PAKET AÇMIYORUZ (bu kararın özü) ─────────────────────────────────────────────
//
// Yeni bir 8'lik paket açsaydık, kullanılmış 3 dersi oraya DÜRÜST yazmanın yolu olmazdı: idari bir
// azaltma `revoked` kovasına düşer, `consumed` ise "bir ders bunu aldı" demektir (CLAUDE.md). Yani
// rebuild, defteri yalan söylemeye zorlardı.
//
// Mevcut paketten 16 krediyi geri almak ise gerçeği söylüyor:
//   granted 8 + restored 16 − consumed 3 − revoked 16 = KALAN 5   ( = 8 − kullanılan 3 )
// `consumed 3` üç dersin gerçekten aldığını, `revoked 16` 31 Ağustos'ta yanlışla eklenen 16'nın
// geri alındığını söyler. Paketin kimliği, 31.08 başlangıcı ve 7 rezervasyonun tamamı dokunulmadan
// kalır — zaten hiçbiri `booked` değil (3 attended, 4 cancelled), yani bozulacak bir gelecek yok.
//
// ── PARA ────────────────────────────────────────────────────────────────────────────────────
//
// 11.000 ₺'lik ödeme ve 24 Ders satışı iptal edilir; 8 Ders / 4.200 ₺ satışı ve tahsilatı GERÇEK
// tarihiyle yeniden kurulur. Ciro, ödemenin `receivedAt`iyle 31 Ağustos'a yazılır (nakit esası).
//
// BİLİNEN EKSİK, dördüncü vaka: `SellInput`'ta `soldAt` yok, yani yeni satışın "satış anı" bugün
// görünür (ciro tarihi doğru, satış tarihi değil). Burcu · Melisa · Duygu'dan sonra bu dördüncü;
// HANDOVER'da "üçüncüde eklenmeli" yazıyordu — artık geciken bir borç.

const STUDIO = 'retro'
const BRANCH = 'mutlukent'
const RUN = 'fix-esra-tepe-8ders-2026-10-06'
const APPLY = process.argv.includes('--apply')

const VAKA = {
  ad: 'ESRA TEPE',
  memberId: 'mem_01M1CA45E2FNJDT5WM1Q3M73BX' as MemberId,
  entitlementId: 'ent_01M1CA6JH244MSJ4R9Y1MM2H2J' as EntitlementId,
  // İptal edilecek 24 Ders tarafı
  eskiSaleId: 'sal_mig_2026_08_31_esra_24ders',
  eskiPaymentId: 'pay_mig_2026_08_31_esra_24ders',
  eskiKurus: 1_100_000,
  // Yeniden kurulacak 8 Ders tarafı — iptal edilmiş kaydın KENDİSİNDEN okundu, tahmin değil
  urunId: 'prd_01KXJD2CHDK9EA6RM869W45J60',
  urun: 'Reformer Pilates - 8 Ders',
  netKurus: 420_000,
  odemeAniIso: '2026-08-31T16:24:51.488Z', // 31.08.2026 19:24:51 TRT
  // Geri alınacak kredi
  geriAlinacak: 16,
} as const

const REASON =
  '24 Ders yerine 8 Ders paketi geçerli: 31 Ağustos\'ta 11.000 ₺ havale geldiği varsayılarak 24 Ders ' +
  'kurulmuştu, ancak o tutar hiç gelmedi — gerçek tahsilat 4.200 ₺. Satış ve tahsilat doğru ürün, ' +
  'tutar ve tarihle yeniden kuruldu; yanlışla eklenen 16 kredi geri alındı, kullanılmış 3 ders ' +
  'üyede kaldı (owner onayı, 2026-10-06).'

const tl = (k: unknown) => `${(Number(k ?? 0) / 100).toLocaleString('tr-TR')} ₺`
const an = (v: unknown) =>
  v instanceof Timestamp ? v.toDate().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' }) : '—'

async function main(): Promise<void> {
  initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID ?? 'studio-yonetim-prod' })
  const db = getFirestore()
  const ctx = {
    studioId: STUDIO,
    actor: { type: 'platform_admin', id: `migration:${RUN}` },
    branchIds: [BRANCH],
    correlationId: RUN,
    source: 'migration',
    role: 'platform_admin',
  } as unknown as TenantContext
  const fin = { repo: new FirestoreFinanceRepository(db), clock: systemClock }
  const entRepo = new FirestoreEntitlementRepository(db)
  const entDeps = { repo: entRepo, clock: systemClock }

  const eskiSatis = await db.doc(`studios/${STUDIO}/sales/${VAKA.eskiSaleId}`).get()
  const eskiOdeme = await db.doc(`studios/${STUDIO}/payments/${VAKA.eskiPaymentId}`).get()
  const yeniSatis = await db.doc(`studios/${STUDIO}/sales/sal_${RUN}`).get()
  const paket = await entRepo.getEntitlement(ctx, VAKA.entitlementId)
  if (!paket) { console.error('DUR: paket bulunamadı.'); process.exit(1) }

  console.log(`━━ ${VAKA.ad}`)
  console.log(`   24 Ders satışı : ${eskiSatis.exists ? `${tl(eskiSatis.get('total.amount'))} · ${eskiSatis.get('status')} · ${an(eskiSatis.get('soldAt'))}` : 'YOK'}`)
  console.log(`   24 Ders ödemesi: ${eskiOdeme.exists ? `${tl(eskiOdeme.get('amount.amount'))} · ${eskiOdeme.get('method')} · iptal=${eskiOdeme.get('voided') === true}` : 'YOK'}`)
  console.log(`   paket defteri  : verilen ${paket.credits?.granted} · iade ${paket.credits?.restored} · harcanan ${paket.credits?.consumed} · geri alınan ${paket.credits?.revoked} → KALAN ${paket.credits ? available(paket.credits) : '—'}`)
  console.log(`   HEDEF          : 8 Ders ${tl(VAKA.netKurus)} · ${new Date(VAKA.odemeAniIso).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' })} · kalan kredi 5 · bakiye 0`)

  // ── KORUMALAR ──
  if (!eskiSatis.exists || !eskiOdeme.exists) { console.error('DUR: 24 Ders kayıtlarından biri yok.'); process.exit(1) }
  if (yeniSatis.exists) { console.log('DUR: düzeltme zaten uygulanmış.'); return }
  if (eskiSatis.get('status') === 'cancelled') { console.error('DUR: 24 Ders satışı zaten iptal.'); process.exit(1) }
  if (eskiOdeme.get('voided') === true) { console.error('DUR: 24 Ders ödemesi zaten iptal.'); process.exit(1) }
  if (Number(eskiSatis.get('total.amount')) !== VAKA.eskiKurus) { console.error('DUR: 24 Ders tutarı beklenenden farklı.'); process.exit(1) }
  if (!paket.credits) { console.error('DUR: paket kredili değil.'); process.exit(1) }
  if (paket.credits.restored < VAKA.geriAlinacak) { console.error(`DUR: iade kovasında ${VAKA.geriAlinacak} kredi yok (${paket.credits.restored}).`); process.exit(1) }
  if (available(paket.credits) < VAKA.geriAlinacak) { console.error('DUR: geri alınacak kadar kullanılabilir kredi yok.'); process.exit(1) }
  // Owner'ın şartı: rezervasyonlara dokunulmaz. Açık rezervasyon varsa DUR — bu betik onları
  // korumayı değil, var olmadığını ÖLÇMEYİ esas alıyor.
  const acik = await db.collection(`studios/${STUDIO}/reservations`)
    .where('memberId', '==', VAKA.memberId).where('status', '==', 'booked').get()
  if (!acik.empty) { console.error(`DUR: ${acik.size} AÇIK rezervasyon var — owner'a sorulmadan devam edilmez.`); process.exit(2) }

  if (!APPLY) {
    console.log(`\n── KURU ÇALIŞMA ── sırayla uygulanacak:`)
    console.log(`   1) ödeme iptali : ${VAKA.eskiPaymentId} (${tl(VAKA.eskiKurus)})`)
    console.log(`   2) satış iptali : ${VAKA.eskiSaleId}`)
    console.log(`   3) yeni satış   : 8 Ders ${tl(VAKA.netKurus)} + tahsilat, ${new Date(VAKA.odemeAniIso).toLocaleDateString('tr-TR')} tarihiyle, aynı pakete bağlı`)
    console.log(`   4) kredi        : ${VAKA.geriAlinacak} kredi geri al → kalan ${available(paket.credits) - VAKA.geriAlinacak}`)
    console.log(`\n   sebep: ${REASON}`)
    console.log(`\n   --apply ile çalıştır.`)
    return
  }

  console.log('\n── UYGULANIYOR ──')
  const vo = await voidPayment(fin, ctx, { paymentId: VAKA.eskiPaymentId, reason: REASON })
  if (!vo.ok) { console.error('1) ÖDEME İPTALİ BAŞARISIZ:', JSON.stringify(vo.error)); process.exit(1) }
  console.log('   1) ✓ ödeme iptal edildi')

  const ca = await cancelSale(fin, ctx, { saleId: VAKA.eskiSaleId, reason: REASON })
  if (!ca.ok) { console.error('2) SATIŞ İPTALİ BAŞARISIZ:', JSON.stringify(ca.error)); process.exit(1) }
  console.log('   2) ✓ satış iptal edildi')

  const sold = await sell(fin, ctx, {
    saleId: `sal_${RUN}`,
    memberId: VAKA.memberId,
    branchId: BRANCH as never,
    lines: [
      {
        productId: VAKA.urunId as never,
        description: VAKA.urun,
        quantity: 1,
        unitPrice: money(VAKA.netKurus),
        entitlementId: VAKA.entitlementId as never,
        giftCardId: null,
      },
    ],
    discounts: [],
    discountCeilingPercent: null,
    payment: {
      paymentId: `pay_${RUN}`,
      allocationId: `alc_${RUN}`,
      amount: money(VAKA.netKurus),
      method: 'bank_transfer',
      receivedAt: instant(Date.parse(VAKA.odemeAniIso)),
      drawerId: null,
      giftCardCode: null,
      note: REASON,
    },
  })
  if (!sold.ok) { console.error('3) SATIŞ BAŞARISIZ:', JSON.stringify(sold.error)); process.exit(1) }
  console.log('   3) ✓ 8 Ders satışı + tahsilatı kuruldu')

  const adj = await adjustCredits(entDeps, ctx, {
    entitlementId: VAKA.entitlementId,
    delta: -VAKA.geriAlinacak,
    reason: 'correction',
    note: REASON,
  })
  if (!adj.ok) { console.error('4) KREDİ DÜZELTMESİ BAŞARISIZ:', JSON.stringify(adj.error)); process.exit(1) }
  console.log('   4) ✓ 16 kredi geri alındı')

  const sonraPaket = await entRepo.getEntitlement(ctx, VAKA.entitlementId)
  const sonraSatis = await db.doc(`studios/${STUDIO}/sales/sal_${RUN}`).get()
  console.log(`\n✅ UYGULANDI`)
  console.log(`   satış : ${sonraSatis.get('status')} · ${tl(sonraSatis.get('paid.amount'))} / ${tl(sonraSatis.get('total.amount'))}`)
  console.log(`   kredi : KALAN ${sonraPaket?.credits ? available(sonraPaket.credits) : '—'} (geri alınan ${sonraPaket?.credits?.revoked})`)
}

main().catch((e) => { console.error(e); process.exit(1) })
