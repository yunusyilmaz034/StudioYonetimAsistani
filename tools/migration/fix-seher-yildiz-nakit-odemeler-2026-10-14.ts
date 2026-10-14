import {
  FirestoreFinanceRepository,
  collect,
  discountSale,
  instant,
  money,
  systemClock,
  voidPayment,
  type BranchId,
  type MemberId,
  type TenantContext,
} from '@studio/core'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

// SEHER YILDIZ — PT 16 DERS: NAKİT FİYATI 20.000 ₺, ÜÇ NAKİT ÖDEME (owner + Işıl, 2026-10-14)
//
//   pnpm tsx tools/migration/fix-seher-yildiz-nakit-odemeler-2026-10-14.ts            # kuru çalışma
//   pnpm tsx tools/migration/fix-seher-yildiz-nakit-odemeler-2026-10-14.ts --apply    # yaz
//
// Işıl: *"10 bin borç · 7.500 8 Ekim'de · 2.500 13 Ekim'de"*. Owner: *"toplam 21 değil 20 olacak; ödeme
// günleri ve şekli yazdığım gibi, hepsi nakit."*
//
// Kayıtta: satış 22.09 22.000 ₺ (KART fiyatı) · 22.09 11.000 ₺ kart · 14.10 15:06 11.000 ₺ nakit (bugün,
// tek parça, yanlış günde). Ürünün nakit fiyatı katalogda 20.000 ₺ — "hepsi nakit" demek fiyat 20.000.
// Doğrusu: 22.09 10.000 nakit (borç 10.000 kalır) · 08.10 7.500 nakit · 13.10 2.500 nakit = 20.000.
// 22.09'daki ilk ödemenin GÜNÜ değişmiyor (kayıttaki saat korunuyor), yalnızca tutarı ve yöntemi.
//
// Satış yeniden kurulmuyor (`soldAt` 22.09 doğru; Duygu Üzülmez notu): kart/nakit farkı 2.000 ₺
// `discountSale` ile yazılıyor, sebebi notta. İndirim yalnızca kalan borçtan düşebildiği için sıra:
//   1) iki ödeme iptal (`voidPayment`)   → borç 22.000
//   2) 2.000 ₺ nakit fiyatı farkı          → borç 20.000
//   3) üç nakit tahsilat, satışa açıkça     → borç 0
//
// KASA (owner nakit dedi, bilerek): bugünün kasası −11.000; 22.09 +10.000, 08.10 +7.500, 13.10 +2.500.
// O günler sayılıp kapandıysa raporlarda o günlerin nakdi artar. Kasa belgesi tek ve günler arası
// ortak, bakiyesi net −11.000 + 20.000 − 0 (ilk ödeme kart olduğu için hiç kasaya girmemişti) = +9.000.

const STUDIO = 'retro'
const BRANCH = 'mutlukent'
const RUN = 'fix-seher-yildiz-nakit-odemeler-2026-10-14'
const APPLY = process.argv.includes('--apply')

const VAKA = {
  memberId: 'mem_01M34SBHAXGMRF5608R0RV01G3',
  saleId: 'sal_01M34SEJVWFF5QR0R07PW2ZQGA',
  drawerId: 'drw_01KXGHV45ZJ91XCHHSNGN7A00H',
  iptal: ['pay_01M34SEJVWFF5QR0R07PW2ZQGA', 'pay_01M4X4X40FQ6ZEJ261KVDJGFGR'],
  farkKurus: 200_000,
  odemeler: [
    { id: `pay_${RUN}_1`, kurus: 1_000_000, at: Date.parse('2026-09-22T17:48:50+03:00'), gun: '22.09.2026' },
    { id: `pay_${RUN}_2`, kurus: 750_000, at: Date.parse('2026-10-08T12:00:00+03:00'), gun: '08.10.2026' },
    { id: `pay_${RUN}_3`, kurus: 250_000, at: Date.parse('2026-10-13T12:00:00+03:00'), gun: '13.10.2026' },
  ],
} as const

const REASON =
  'Seher Yıldız PT 16 Ders nakit ödendi: nakit fiyatı 20.000 ₺ (kart 22.000). Ödemeler 22.09 10.000, 08.10 7.500, ' +
  '13.10 2.500 — hepsi nakit. Önceki kayıt (22.09 11.000 kart + 14.10 11.000 nakit) yanlıştı (owner/Işıl, 2026-10-14).'

const tl = (k: number): string => `${(k / 100).toLocaleString('tr-TR')} ₺`

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
  const dur = (m: string): never => { console.error(`DUR: ${m}`); process.exit(1) }
  const doc = (c: string, id: string) => db.doc(`studios/${STUDIO}/${c}/${id}`).get()

  const oku = async () => {
    const [satis, ...pay] = await Promise.all([doc('sales', VAKA.saleId), ...VAKA.iptal.map((id) => doc('payments', id)), ...VAKA.odemeler.map((o) => doc('payments', o.id))])
    return { satis, eski: pay.slice(0, 2), yeni: pay.slice(2) }
  }
  const d = await oku()
  if (!d.satis.exists || d.satis.get('memberId') !== VAKA.memberId) return dur('satış tanıdaki gibi değil.')
  for (const p of d.eski) if (!p.exists || p.get('memberId') !== VAKA.memberId || Number(p.get('amount.amount')) !== 1_100_000) dur(`ödeme tanıdaki gibi değil: ${p.id}`)
  const indirim = Number(d.satis.get('discountTotal.amount') ?? 0)
  if (indirim !== 0 && indirim !== VAKA.farkKurus) dur(`satışta beklenmeyen indirim: ${tl(indirim)}`)

  console.log(`━━ SEHER YILDIZ · satış ${d.satis.get('status')} · toplam ${tl(Number(d.satis.get('total.amount')))} · ödenen ${tl(Number(d.satis.get('paid.amount')))} · indirim ${tl(indirim)}`)
  console.log(`\n── ${APPLY ? 'UYGULANIYOR' : 'KURU ÇALIŞMA'} ──`)
  for (const p of d.eski) console.log(`   iptal: ${p.id} · ${tl(Number(p.get('amount.amount')))} ${p.get('method')}${p.get('voided') ? ' — ZATEN İPTAL' : ''}`)
  console.log(`   fark : ${tl(VAKA.farkKurus)} nakit fiyatı${indirim ? ' — ZATEN YAZILMIŞ' : ''}`)
  VAKA.odemeler.forEach((o, i) => console.log(`   tahsil: ${o.gun} · ${tl(o.kurus)} nakit${d.yeni[i]!.exists ? ' — ZATEN VAR' : ''}`))
  console.log(`   sebep: ${REASON}`)
  if (!APPLY) { console.log('\n   --apply ile çalıştır.'); return }

  for (const p of d.eski) {
    if (p.get('voided')) continue
    const r = await voidPayment(fin, ctx, { paymentId: p.id, reason: REASON })
    if (!r.ok) dur(`iptal ${p.id}: ${JSON.stringify(r.error)}`)
    console.log(`   ✓ iptal ${p.id}`)
  }
  if (!indirim) {
    const r = await discountSale(fin, ctx, {
      saleId: VAKA.saleId,
      discount: { reason: 'manual', amount: money(VAKA.farkKurus), note: REASON, couponCode: null, referredByMemberId: null, grantedBy: ctx.actor },
    })
    if (!r.ok) dur(`fark: ${JSON.stringify(r.error)} — ödemeler iptal edildi, borç 22.000 görünür. Betiği yeniden çalıştır.`)
    console.log('   ✓ 2.000 ₺ nakit fiyatı farkı')
  }
  for (const [i, o] of VAKA.odemeler.entries()) {
    if (d.yeni[i]!.exists) continue
    const r = await collect(fin, ctx, {
      paymentId: o.id,
      memberId: VAKA.memberId as MemberId,
      branchId: BRANCH as BranchId,
      amount: money(o.kurus),
      method: 'cash',
      receivedAt: instant(o.at),
      drawerId: VAKA.drawerId,
      giftCardCode: null,
      note: REASON,
      allocateTo: [{ saleId: VAKA.saleId, amount: money(o.kurus), allocationId: `alc_${RUN}_${i + 1}` }],
    })
    if (!r.ok) return dur(`tahsilat ${o.gun}: ${JSON.stringify(r.error)} — betiği yeniden çalıştır, yapılanlar atlanır.`)
    if (r.value.unallocated > 0) console.warn(`   UYARI: ${tl(r.value.unallocated)} tahsis edilemedi.`)
    console.log(`   ✓ ${o.gun} ${tl(o.kurus)} nakit`)
  }

  const s = await oku()
  console.log(`\n✅ SON DURUM · satış ${s.satis.get('status')} · toplam ${tl(Number(s.satis.get('total.amount')))} · ödenen ${tl(Number(s.satis.get('paid.amount')))} · indirim ${tl(Number(s.satis.get('discountTotal.amount') ?? 0))}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
