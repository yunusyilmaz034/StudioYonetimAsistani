import {
  FirestoreEntitlementRepository,
  FirestoreFinanceRepository,
  adjustCredits,
  cancelEntitlement,
  cancelSale,
  collect,
  instant,
  money,
  sellPackage,
  systemClock,
  voidPayment,
  type BranchId,
  type EntitlementId,
  type MemberId,
  type FinancePaymentMethod as PaymentMethod,
  type ProductId,
  type TenantContext,
} from '@studio/core'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'

// SEVİM YERKAN — FITNESS 6 AYLIK → REFORMER PILATES 8 DERS (owner, 2026-11-02)
//
//   pnpm tsx tools/migration/fix-sevim-yerkan-pilates-8-2026-11-02.ts            # kuru çalışma
//   pnpm tsx tools/migration/fix-sevim-yerkan-pilates-8-2026-11-02.ts --apply    # yaz
//
// Işıl: *"fitness paketini iptal ettirmek istedi, pilatese çevirdi. 1000 TL havale 19 Ekim'de alınmıştı.
// 8 ders pilates eklenecek, ilk dersine 26 Ekim'de geldi, paket başlangıcı o. Bugün 3.200 TL nakit ödedi."*
//
// Tanı (`tani-sevim-yerkan-2026-11-02.ts`):
//   - Fitness 6 Aylık 12.750 (26.10 →), satış açık, 1.000 havale (19.10) bu satışa bağlı.
//   - Reformer 4 Ders 2.500 ödemesiz; masa bugün 10:14'te satışı ve paketi iptal etti. 26.10 13:30 dersi
//     (katıldı) bu paketten 1 hak tüketmişti.
//   - Bugünkü 3.200 nakit henüz girilmemiş.
//
// ADIMLAR (Merve Uslu çevirmesiyle aynı use-case'ler):
//   1) voidPayment   — 19.10 1.000 havale (fitness satışından çözmek için)
//   2) cancelSale    — Fitness 6 Aylık satışı
//   3) sellPackage   — Reformer Pilates 8 Ders, 4.200 (nakit fiyatı = 1.000 + 3.200), başlangıç 26.10.2026
//   4) cancelEntitlement — Fitness 6 Aylık paketi
//   5) collect ×2    — 19.10 1.000 havale (eski saatiyle, kasasız) + bugün 3.200 nakit Merkez Kasa'ya
//   6) adjustCredits −1 (correction) — 26.10 dersi iptal edilen 4 derslik paketten düşmüştü; aynı ders yeni
//      paketten de sayılsın diye 8 dersten 1 hak geri alınır → 7 kalır. Rezervasyonun kendisine dokunulmaz.

const STUDIO = 'retro'
const BRANCH = 'mutlukent'
const RUN = 'fix-sevim-yerkan-pilates-8-2026-11-02'
const APPLY = process.argv.includes('--apply')

const VAKA = {
  memberId: 'mem_01M59PS977PWRA3A15D4T4BX7P' as MemberId,
  fitnessPaket: 'ent_01M59PWR0WEP4KYD0M3N8FZB3K' as EntitlementId,
  fitnessSatis: 'sal_01M59PWR0VB8XEW5XSYKQ3D9BH',
  havale: 'pay_01M59VNEBZM02HP5GY8HQ8M1PH',
  urun: 'prd_01KXJD2CHDK9EA6RM869W45J60', // Reformer Pilates - 8 Ders
  fiyatKurus: 420_000,
  baslangic: Date.parse('2026-10-26T00:00:00+03:00'),
  drawerId: 'drw_01KXGHV45ZJ91XCHHSNGN7A00H', // Merkez Kasa
} as const

const REASON =
  'Sevim Yerkan Fitness 6 Aylık paketini iptal ettirip Reformer Pilates 8 Ders\'e çevirdi (4.200 ₺): 19.10 1.000 ₺ ' +
  'havale + 02.11 3.200 ₺ nakit. Başlangıç ilk dersi 26.10.2026 (owner, 2026-11-02).'
const NOTE_26 =
  '26.10.2026 13:30 Reformer dersi iptal edilen 4 derslik paketten düşmüştü; 8 derslik pakete taşındı (owner, 2026-11-02).'

const tl = (k: number): string => `${(k / 100).toLocaleString('tr-TR')} ₺`
const ms = (v: unknown): number => (v instanceof Timestamp ? v.toMillis() : Number(v ?? 0))
const gun = (t: number): string => new Date(t).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' })

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
  const ent = { repo: new FirestoreEntitlementRepository(db), clock: systemClock }
  const dur = (m: string): never => { console.error(`DUR: ${m}`); process.exit(1) }
  const col = (c: string) => db.collection(`studios/${STUDIO}/${c}`)

  const [fitPaket, fitSatis, urun, havale, kasa] = await Promise.all([
    col('entitlements').doc(VAKA.fitnessPaket).get(),
    col('sales').doc(VAKA.fitnessSatis).get(),
    col('products').doc(VAKA.urun).get(),
    col('payments').doc(VAKA.havale).get(),
    col('cashDrawers').doc(VAKA.drawerId).get(),
  ])
  if (fitPaket.get('memberId') !== VAKA.memberId || fitPaket.get('productSnapshot.category') !== 'fitness') return dur('fitness paketi tanıdaki gibi değil.')
  if (fitSatis.get('memberId') !== VAKA.memberId || Number(fitSatis.get('total.amount')) !== 1_275_000) return dur('fitness satışı tanıdaki gibi değil.')
  if (urun.get('name') !== 'Reformer Pilates - 8 Ders' || Number(urun.get('creditCount')) !== 8 || Number(urun.get('cashPriceInKurus')) !== VAKA.fiyatKurus) return dur('8 ders ürünü beklenen gibi değil.')
  if (havale.get('memberId') !== VAKA.memberId || Number(havale.get('amount.amount')) !== 100_000 || havale.get('method') !== 'bank_transfer') return dur('havale tanıdaki gibi değil.')
  if (kasa.get('status') !== 'open') return dur('Merkez Kasa açık değil.')

  // Yeniden çalıştırmada: daha önce verilmiş 8 ders paketi ve satışı.
  const paketler = await col('entitlements').where('memberId', '==', VAKA.memberId).get()
  const yeniPaket = paketler.docs.find((d) => d.get('productId') === VAKA.urun && d.get('status') !== 'cancelled')
  const satislar = await col('sales').where('memberId', '==', VAKA.memberId).get()
  const yeniSatisBul = (entId: string) =>
    satislar.docs.find((s) => s.get('status') !== 'cancelled' && (s.get('lines') as { entitlementId?: string }[] | undefined)?.some((l) => l.entitlementId === entId))

  const tahsilatlar: { id: string; kurus: number; at: number; method: PaymentMethod; drawerId: string | null }[] = [
    { id: `pay_${RUN}_1`, kurus: 100_000, at: ms(havale.get('receivedAt')), method: 'bank_transfer' as PaymentMethod, drawerId: null },
    { id: `pay_${RUN}_2`, kurus: 320_000, at: Date.now(), method: 'cash' as PaymentMethod, drawerId: VAKA.drawerId },
  ]
  if (tahsilatlar.reduce((s, t) => s + t.kurus, 0) !== VAKA.fiyatKurus) return dur('tahsilatlar 4.200 etmiyor.')
  const varMi = await Promise.all(tahsilatlar.map((t) => col('payments').doc(t.id).get()))

  console.log(`━━ SEVİM YERKAN · ${APPLY ? 'UYGULANIYOR' : 'KURU ÇALIŞMA'}`)
  console.log(`   iptal ödeme : ${VAKA.havale} · ${gun(ms(havale.get('receivedAt')))} · 1.000 ₺ havale${havale.get('voided') ? ' — ZATEN İPTAL' : ''}`)
  console.log(`   iptal satış : Fitness 6 Aylık 12.750${fitSatis.get('status') === 'cancelled' ? ' — ZATEN İPTAL' : ''}`)
  console.log(`   iptal paket : ${VAKA.fitnessPaket}${fitPaket.get('status') === 'cancelled' ? ' — ZATEN İPTAL' : ''}`)
  console.log(`   yeni paket  : Reformer Pilates - 8 Ders · ${tl(VAKA.fiyatKurus)} · ${gun(VAKA.baslangic)} → +30 gün${yeniPaket ? ` — ZATEN VAR (${yeniPaket.id})` : ''}`)
  tahsilatlar.forEach((t, i) => console.log(`   tahsil      : ${gun(t.at)} · ${tl(t.kurus)} ${t.method} · ${t.drawerId ? 'Merkez Kasa' : 'kasasız'}${varMi[i]!.exists ? ' — ZATEN VAR' : ''}`))
  console.log(`   hak         : 8 → 7 (26.10 dersi)`)
  if (!APPLY) { console.log('\n   --apply ile çalıştır.'); return }

  if (!havale.get('voided')) {
    const r = await voidPayment(fin, ctx, { paymentId: VAKA.havale, reason: REASON })
    if (!r.ok) return dur(`havale iptali: ${JSON.stringify(r.error)}`)
    console.log('   ✓ havale iptal (yeni satışa yeniden yazılacak)')
  }
  if (fitSatis.get('status') !== 'cancelled') {
    const r = await cancelSale(fin, ctx, { saleId: VAKA.fitnessSatis, reason: REASON })
    if (!r.ok) return dur(`satış iptali: ${JSON.stringify(r.error)}`)
    console.log('   ✓ fitness satışı iptal')
  }

  let entId = yeniPaket?.id as EntitlementId | undefined
  let saleId = entId ? yeniSatisBul(entId)?.id : undefined
  const yeniKuruldu = !entId
  if (!entId) {
    const p = urun
    const r = await sellPackage({ finance: fin, entitlements: ent }, ctx, {
      branchId: BRANCH as BranchId,
      subscription: {
        memberId: VAKA.memberId,
        productId: p.id as ProductId,
        productSnapshot: {
          productId: p.id as ProductId,
          name: p.get('name'),
          category: p.get('category'),
          grant: { kind: 'credits', credits: Number(p.get('creditCount')), validForDays: Number(p.get('durationDays')) },
          listPrice: money(p.get('priceInKurus')),
          serviceIds: p.get('serviceIds'),
          cancellationAllowanceCount: p.get('cancellationAllowanceCount') ?? null,
          dailyReservationLimit: p.get('dailyReservationLimit') ?? null,
          activeReservationLimit: p.get('activeReservationLimit') ?? null,
          entryAllowance: p.get('entryAllowance') ?? null,
        },
        policyRef: { policyId: p.id, version: 1 },
        priceAgreed: money(VAKA.fiyatKurus),
        validFrom: VAKA.baslangic,
        validUntil: null,
        freezeDays: Number(p.get('freezeAllowanceDays') ?? 0) > 0 ? Number(p.get('freezeAllowanceDays')) : null,
        creditOverride: null,
        collectedAmount: money(0),
        method: 'cash',
        note: REASON,
      } as never,
      payment: null,
      discountCeilingPercent: null,
    })
    if (!r.ok) return dur(`8 ders satışı: ${JSON.stringify(r.error)}`)
    entId = r.value.entitlementId as EntitlementId
    saleId = r.value.saleId
    console.log(`   ✓ 8 ders ${entId} · satış ${saleId}`)
  }
  if (!saleId) return dur('8 ders paketinin satışı bulunamadı.')

  if (fitPaket.get('status') !== 'cancelled') {
    const r = await cancelEntitlement(ent, ctx, { entitlementId: VAKA.fitnessPaket, reason: REASON, refundPaymentId: null })
    if (!r.ok) return dur(`fitness paketi iptali: ${JSON.stringify(r.error)}`)
    console.log('   ✓ fitness paketi iptal')
  }

  for (const [i, t] of tahsilatlar.entries()) {
    if (varMi[i]!.exists) continue
    const r = await collect(fin, ctx, {
      paymentId: t.id,
      memberId: VAKA.memberId,
      branchId: BRANCH as BranchId,
      amount: money(t.kurus),
      method: t.method,
      receivedAt: instant(t.at),
      drawerId: t.drawerId,
      allowNoDrawer: t.drawerId === null,
      giftCardCode: null,
      note: REASON,
      allocateTo: [{ saleId, amount: money(t.kurus), allocationId: `alc_${RUN}_${i + 1}` }],
    } as never)
    if (!r.ok) return dur(`tahsilat ${gun(t.at)}: ${JSON.stringify(r.error)} — betiği yeniden çalıştır, yapılanlar atlanır.`)
    if (r.value.unallocated > 0) console.warn(`   UYARI: ${tl(r.value.unallocated)} tahsis edilemedi.`)
    console.log(`   ✓ ${gun(t.at)} ${tl(t.kurus)}`)
  }

  // Yalnız paketi BU çalıştırma kurduysa — yeniden çalıştırmada hak iki kez düşmesin.
  if (yeniKuruldu) {
    const r = await adjustCredits(ent, ctx, { entitlementId: entId, delta: -1, reason: 'correction', note: NOTE_26 })
    if (!r.ok) return dur(`hak düzeltmesi: ${JSON.stringify(r.error)}`)
    console.log('   ✓ 26.10 dersi için 1 hak düşüldü')
  }

  const [s, e] = await Promise.all([col('sales').doc(saleId).get(), col('entitlements').doc(entId).get()])
  console.log(`\n✅ SON DURUM · ${e.get('productSnapshot.name')} · ${e.get('status')} · ${gun(ms(e.get('validFrom')))} → ${gun(ms(e.get('validUntil')))} · kalan ${e.get('credits.available')} · satış ${s.get('status')} · toplam ${tl(Number(s.get('total.amount')))} · ödenen ${tl(Number(s.get('paid.amount')))}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
