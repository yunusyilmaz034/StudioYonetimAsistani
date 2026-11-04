import { FirestoreFinanceRepository, collect, instant, money, systemClock, type BranchId, type MemberId, type TenantContext } from '@studio/core'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

// EMİNE KAHVECİ — 03.11 AKŞAMI 3.500 ₺ HAVALE (owner, 2026-11-04: "dün akşam 3500 TL havale yapmış, dünün kasasına ekle")
//
//   pnpm tsx tools/migration/fix-emine-kahveci-havale-2026-11-03.ts            # kuru çalışma
//   pnpm tsx tools/migration/fix-emine-kahveci-havale-2026-11-03.ts --apply    # yaz
//
// Kayıtta: 02.11 Fitness 3 Aylık satıldı, toplam 8.500 (9.500 − 1.000 indirim), 02.11 1.000 havale ödendi →
// borç 7.500. Bu tahsilat o satışa açıkça yazılır; borç 4.000'e iner. GÜN 03.11 (kasa o güne sayar).
// SAAT YAKLAŞIK: owner "akşam" dedi, saat bilinmiyor → 20:00 (İstanbul) yazıldı; gün doğru, saat tahmin.
// Havale çekmeceye girmez (drawerId null), mevcut 02.11 havalesiyle aynı.
const STUDIO = 'retro'
const BRANCH = 'mutlukent'
const RUN = 'fix-emine-kahveci-havale-2026-11-03'
const APPLY = process.argv.includes('--apply')
const VAKA = {
  memberId: 'mem_01M6DQAJZ576TH1MTNKZZASTVG',
  saleId: 'sal_01M6DQFQD2KHXFZE0WRS4PJSJY',
  paymentId: `pay_${RUN}`,
  kurus: 350_000,
  at: 1_793_725_200_000, // 2026-11-03 20:00 Europe/Istanbul
  beklenenToplam: 850_000,
  beklenenOdenen: 100_000,
} as const
const REASON = 'Emine Kahveci 03.11 akşamı 3.500 ₺ havale (Fitness 3 Aylık satışına). Saat yaklaşık 20:00; owner, 2026-11-04.'
const tl = (k: number): string => `${(k / 100).toLocaleString('tr-TR')} ₺`

async function main(): Promise<void> {
  initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID ?? 'studio-yonetim-prod' })
  const db = getFirestore()
  const ctx = { studioId: STUDIO, actor: { type: 'platform_admin', id: `migration:${RUN}` }, branchIds: [BRANCH], correlationId: RUN, source: 'migration', role: 'platform_admin' } as unknown as TenantContext
  const fin = { repo: new FirestoreFinanceRepository(db), clock: systemClock }
  const dur = (m: string): never => {
    console.error(`DUR: ${m}`)
    process.exit(1)
  }
  const [satis, var_] = await Promise.all([db.doc(`studios/${STUDIO}/sales/${VAKA.saleId}`).get(), db.doc(`studios/${STUDIO}/payments/${VAKA.paymentId}`).get()])
  if (!satis.exists || satis.get('memberId') !== VAKA.memberId || Number(satis.get('total.amount')) !== VAKA.beklenenToplam) return dur('satış tanıdaki gibi değil.')
  const odenen = Number(satis.get('paid.amount'))
  console.log(`━━ EMİNE KAHVECİ · satış ${satis.get('status')} · toplam ${tl(VAKA.beklenenToplam)} · ödenen ${tl(odenen)} · borç ${tl(VAKA.beklenenToplam - odenen)}`)
  console.log(`\n── ${APPLY ? 'UYGULANIYOR' : 'KURU ÇALIŞMA'} ──`)
  console.log(`   tahsil: 03.11.2026 ~20:00 · ${tl(VAKA.kurus)} havale → bu satış${var_.exists ? ' — ZATEN VAR' : ''}`)
  console.log(`   sonra : ödenen ${tl(odenen + (var_.exists ? 0 : VAKA.kurus))} · borç ${tl(VAKA.beklenenToplam - odenen - (var_.exists ? 0 : VAKA.kurus))}`)
  if (var_.exists) return
  if (odenen !== VAKA.beklenenOdenen) return dur(`ödenen ${tl(odenen)}, beklenen ${tl(VAKA.beklenenOdenen)} — biri bu arada tahsilat girmiş olabilir; kontrol et.`)
  if (!APPLY) return console.log('\n   --apply ile çalıştır.')
  const r = await collect(fin, ctx, {
    paymentId: VAKA.paymentId,
    memberId: VAKA.memberId as MemberId,
    branchId: BRANCH as BranchId,
    amount: money(VAKA.kurus),
    method: 'bank_transfer',
    receivedAt: instant(VAKA.at),
    drawerId: null,
    giftCardCode: null,
    note: REASON,
    allocateTo: [{ saleId: VAKA.saleId, amount: money(VAKA.kurus), allocationId: `alc_${RUN}` }],
  })
  if (!r.ok) return dur(`tahsilat: ${JSON.stringify(r.error)}`)
  if (r.value.unallocated > 0) console.warn(`   UYARI: ${tl(r.value.unallocated)} tahsis edilemedi.`)
  const s = await db.doc(`studios/${STUDIO}/sales/${VAKA.saleId}`).get()
  console.log(`\n✅ SON · satış ${s.get('status')} · ödenen ${tl(Number(s.get('paid.amount')))} · borç ${tl(VAKA.beklenenToplam - Number(s.get('paid.amount')))}`)
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
