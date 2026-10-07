import {
  cancelEntitlement,
  cancelSale,
  FirestoreCatalogRepository,
  FirestoreEntitlementRepository,
  FirestoreFinanceRepository,
  instant,
  money,
  sellPackage,
  systemClock,
  type AssignSubscriptionInput,
  type BranchId,
  type EntitlementId,
  type Grant,
  type MemberId,
  type TenantContext,
} from '@studio/core'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'

// NİHAL PESTİL — FITNESS 3 AYLIK İPTAL, AYNI TARİHTEN 6 AYLIK (owner, 2026-10-07)
//
//   pnpm tsx tools/migration/fix-nihal-pestil-6aylik-2026-10-07.ts            # kuru çalışma
//   pnpm tsx tools/migration/fix-nihal-pestil-6aylik-2026-10-07.ts --apply    # yaz
//
// Owner: *"daha önce fitness 3 aylık almış, borçlu kaydettik, 16 eylülde başlamış. Bugün 6 aylık almak
// istedi, 12.500 TL ödedi, 250 TL daha borcu var. 3 aylık iptal ama aynı tarihten başlayarak 6 aylık
// olacak, ücreti 12.750 olarak anlaşılmış. 12.500 ödedi nakit, kasaya ekle bugün, 250 TL de borçlu
// kaydet."*
//
// Tanı (`tani-nihal-pestil-2026-10-07.ts`): 3 Aylık satışı 8.500 ₺, AÇIK, üstünde hiç ödeme yok;
// rezervasyonu yok. Yani iade edilecek para, taşınacak rezervasyon yok.
//
// MASANIN YAPACAĞI ÜÇ İŞLEM, aynı use-case'lerle ve aynı sırayla — elle veri yazımı yok:
//   1) cancelSale        — 3 Aylık'ın 8.500 ₺'lik açık satışı (borç silinir)
//   2) cancelEntitlement — 3 Aylık paketin kendisi
//   3) sellPackage       — 6 Aylık, 16.09.2026'dan, 12.750 ₺ anlaşılan, 12.500 ₺ nakit BUGÜN, açık kasaya
//
// Sıra bilerek böyle: önce eski borç ve paket kapanır, sonra yenisi açılır. Arada ölürse üye paketsiz
// kalır (görünür ve betik yeniden çalıştırılabilir); ters sırada ölseydi iki aktif paket ve iki borç
// kalırdı — sessiz ve yanlış.

const STUDIO = 'retro'
const BRANCH = 'mutlukent'
const RUN = 'fix-nihal-pestil-6aylik-2026-10-07'
const APPLY = process.argv.includes('--apply')

const VAKA = {
  memberId: 'mem_01KXN38ZWG508WGYVBC0GV7W9R' as MemberId,
  eskiSaleId: 'sal_01M2NCT3QR3H88W7YBFMR0N2EA',
  eskiEntitlementId: 'ent_01M2NCT3QSQCK3DXZKJJ0S2QE3' as EntitlementId,
  eskiKurus: 850_000,
  yeniUrunAdi: 'Fitness - 6 Aylık',
  baslangic: '2026-09-16',
  anlasilanKurus: 1_275_000,
  odenenKurus: 1_250_000,
} as const

const REASON =
  'Fitness 3 Aylık yerine 6 Aylık: üye 7 Ekim\'de 6 aylığa geçti. 3 Aylık (8.500 ₺, hiç ödenmemiş) iptal ' +
  'edildi; 6 Aylık aynı başlangıç tarihiyle (16.09.2026) 12.750 ₺ anlaşılan fiyatla kuruldu, 12.500 ₺ ' +
  'nakit alındı, 250 ₺ borç kaldı (owner talimatı, 2026-10-07).'

const tl = (k: unknown) => `${(Number(k ?? 0) / 100).toLocaleString('tr-TR')} ₺`
const gun = (v: unknown) =>
  (v instanceof Timestamp ? v.toDate() : new Date(Number(v))).toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul' })
const dayMs = (d: string): number => Date.parse(`${d}T00:00:00Z`) - 180 * 60_000

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
  const finRepo = new FirestoreFinanceRepository(db)
  const fin = { repo: finRepo, clock: systemClock }
  const entRepo = new FirestoreEntitlementRepository(db)
  const entDeps = { repo: entRepo, clock: systemClock }

  const [eskiSatis, eskiPaket, urunler, kasalar, paketler, odemeler] = await Promise.all([
    db.doc(`studios/${STUDIO}/sales/${VAKA.eskiSaleId}`).get(),
    entRepo.getEntitlement(ctx, VAKA.eskiEntitlementId),
    new FirestoreCatalogRepository(db).listProducts(ctx),
    finRepo.listDrawers(ctx),
    entRepo.listByMember(ctx, VAKA.memberId),
    db.collection(`studios/${STUDIO}/payments`).where('memberId', '==', VAKA.memberId).get(),
  ])
  const urun = urunler.filter((u) => u.name === VAKA.yeniUrunAdi)
  const kasa = kasalar.find((d) => d.status === 'open' && d.kind === 'cash') ?? null

  console.log('━━ NİHAL PESTİL')
  console.log(`   3 Aylık satışı : ${eskiSatis.exists ? `${tl(eskiSatis.get('total.amount'))} · ödenen ${tl(eskiSatis.get('paid.amount'))} · ${eskiSatis.get('status')}` : 'YOK'}`)
  console.log(`   3 Aylık paketi : ${eskiPaket ? `${eskiPaket.status} · ${gun(eskiPaket.validFrom)} → ${gun(eskiPaket.validUntil)}` : 'YOK'}`)
  console.log(`   6 Aylık ürünü  : ${urun.map((u) => `${u.id} · ${u.durationDays} gün · liste ${tl(u.priceInKurus)} · aktif=${u.active} · tip=${u.type}`).join(' | ') || 'BULUNAMADI'}`)
  console.log(`   açık nakit kasa: ${kasa ? kasa.id : 'YOK'}`)

  // ── KORUMALAR ──
  const dur = (m: string, kod = 1): never => { console.error(`DUR: ${m}`); process.exit(kod) }
  if (!eskiSatis.exists || !eskiPaket) dur('3 Aylık kayıtlarından biri yok.')
  if (eskiSatis.get('memberId') !== VAKA.memberId || eskiPaket!.memberId !== VAKA.memberId) dur('kayıtlar bu üyeye ait değil.')
  if (paketler.some((e) => e.status === 'active' && e.productSnapshot.name === VAKA.yeniUrunAdi)) { console.log('DUR: 6 Aylık zaten kurulmuş.'); return }
  if (urun.length !== 1) dur(`"${VAKA.yeniUrunAdi}" katalogda tam bir tane değil (${urun.length}).`)
  if (urun[0]!.type === 'credit' || (urun[0]!.components?.length ?? 0) > 0) dur('6 Aylık süreli, tek bileşenli bir ürün değil.')
  if (Number(eskiSatis.get('total.amount')) !== VAKA.eskiKurus) dur('3 Aylık tutarı beklenenden farklı.')
  if (Number(eskiSatis.get('paid.amount') ?? 0) !== 0) dur('3 Aylık satışının üstünde ödeme var — iade kararı owner\'ın.', 2)
  if (odemeler.docs.some((p) => p.get('voided') !== true)) dur('üyenin iptal edilmemiş bir ödemesi var — tanıdan sonra bir şey değişmiş.', 2)
  const satisDurumu = eskiSatis.get('status')
  const paketDurumu = eskiPaket!.status
  if (satisDurumu !== 'open' && satisDurumu !== 'cancelled') dur(`3 Aylık satışı beklenmeyen durumda: ${satisDurumu}`)
  if (paketDurumu !== 'active' && paketDurumu !== 'cancelled') dur(`3 Aylık paketi beklenmeyen durumda: ${paketDurumu}`)
  const acikRez = await db.collection(`studios/${STUDIO}/reservations`).where('memberId', '==', VAKA.memberId).where('status', '==', 'booked').get()
  if (!acikRez.empty) dur(`${acikRez.size} açık rezervasyon var.`, 2)
  // Nakit, kasaya girmeden kaydedilmez: owner "kasaya ekle" dedi.
  if (!kasa) dur('açık nakit kasa yok — 12.500 ₺ kasaya yazılamaz. Kasa açılınca yeniden çalıştır.', 2)

  const u = urun[0]!
  const bitis = dayMs(VAKA.baslangic) + u.durationDays * 86_400_000
  console.log(`\n   HEDEF: ${u.name} · ${gun(dayMs(VAKA.baslangic))} → ${gun(bitis)} (${u.durationDays} gün) · anlaşılan ${tl(VAKA.anlasilanKurus)} · nakit ${tl(VAKA.odenenKurus)} · borç ${tl(VAKA.anlasilanKurus - VAKA.odenenKurus)}`)

  if (!APPLY) {
    console.log('\n── KURU ÇALIŞMA ── sırayla uygulanacak:')
    console.log(`   1) satış iptali : ${VAKA.eskiSaleId} (${tl(VAKA.eskiKurus)}, ödenmemiş)${satisDurumu === 'cancelled' ? ' — ZATEN İPTAL, atlanır' : ''}`)
    console.log(`   2) paket iptali : ${VAKA.eskiEntitlementId}${paketDurumu === 'cancelled' ? ' — ZATEN İPTAL, atlanır' : ''}`)
    console.log(`   3) yeni satış   : ${u.name} + ${tl(VAKA.odenenKurus)} nakit → kasa ${kasa!.id}`)
    console.log(`\n   sebep: ${REASON}\n\n   --apply ile çalıştır.`)
    return
  }

  console.log('\n── UYGULANIYOR ──')
  if (satisDurumu === 'open') {
    const r = await cancelSale(fin, ctx, { saleId: VAKA.eskiSaleId, reason: REASON })
    if (!r.ok) dur(`1) SATIŞ İPTALİ BAŞARISIZ: ${JSON.stringify(r.error)}`)
    console.log('   1) ✓ 3 Aylık satışı iptal edildi')
  } else console.log('   1) – satış zaten iptal')

  if (paketDurumu === 'active') {
    const r = await cancelEntitlement(entDeps, ctx, { entitlementId: VAKA.eskiEntitlementId, reason: REASON, refundPaymentId: null })
    if (!r.ok) dur(`2) PAKET İPTALİ BAŞARISIZ: ${JSON.stringify(r.error)}`)
    console.log('   2) ✓ 3 Aylık paketi iptal edildi')
  } else console.log('   2) – paket zaten iptal')

  // Masanın `assignSubscriptionAction`ı ile AYNI şekil: snapshot katalogdan, fiyat anlaşılan tutar.
  const grant: Grant = { kind: 'period', durationDays: u.durationDays, access: 'unlimited' }
  const subscription = {
    memberId: VAKA.memberId,
    productId: u.id,
    productSnapshot: {
      productId: u.id,
      name: u.name,
      category: u.category,
      grant,
      listPrice: money(u.priceInKurus),
      serviceIds: u.serviceIds,
      cancellationAllowanceCount: u.cancellationAllowanceCount,
      dailyReservationLimit: u.dailyReservationLimit,
      activeReservationLimit: u.activeReservationLimit,
      entryAllowance: u.entryAllowance ?? null,
    },
    policyRef: { policyId: u.id, version: 1 },
    priceAgreed: money(VAKA.anlasilanKurus),
    validFrom: dayMs(VAKA.baslangic),
    validUntil: null,
    freezeDays: u.freezeAllowanceDays > 0 ? u.freezeAllowanceDays : null,
    creditOverride: null,
    collectedAmount: money(0),
    method: 'cash',
    note: REASON,
  } satisfies AssignSubscriptionInput

  const sold = await sellPackage({ finance: fin, entitlements: entDeps }, ctx, {
    branchId: BRANCH as BranchId,
    subscription,
    discounts: [],
    payment: {
      amount: money(VAKA.odenenKurus),
      method: 'cash',
      receivedAt: instant(Date.now()),
      drawerId: kasa!.id,
      giftCardCode: null,
      note: REASON,
      allowNoDrawer: false,
    },
    discountCeilingPercent: null,
  })
  if (!sold.ok) dur(`3) SATIŞ BAŞARISIZ: ${JSON.stringify(sold.error)} — 3 Aylık İPTAL EDİLDİ, üye şu an paketsiz. Betiği yeniden çalıştır.`)
  console.log('   3) ✓ 6 Aylık satışı + nakit tahsilatı kuruldu')

  const [sonPaketler, sonSatislar] = await Promise.all([
    entRepo.listByMember(ctx, VAKA.memberId),
    db.collection(`studios/${STUDIO}/sales`).where('memberId', '==', VAKA.memberId).get(),
  ])
  console.log('\n✅ UYGULANDI')
  for (const e of sonPaketler) console.log(`   paket: ${e.productSnapshot.name} · ${e.status} · ${gun(e.validFrom)} → ${gun(e.validUntil)}`)
  for (const s of sonSatislar.docs) console.log(`   satış: ${s.id} · ${s.get('status')} · ${tl(s.get('paid.amount'))} / ${tl(s.get('total.amount'))}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
