import {
  FirestoreFinanceRepository,
  collect,
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

// SEVİM AYGÜN — FITNESS 12 AYLIK 19.500 ₺: 06.10 8.500 + 15.10 11.000, İKİSİ NAKİT (Işıl → owner, 2026-10-15)
//
//   pnpm tsx tools/migration/fix-sevim-aygun-odemeler-2026-10-15.ts            # kuru çalışma
//   pnpm tsx tools/migration/fix-sevim-aygun-odemeler-2026-10-15.ts --apply    # yaz
//
// Işıl: *"bugün 11 bin verdi · 6 Ekim'de 8.500 vermişti · düzeltir misin"*.
//
// Kayıtta: 06.10 Fitness 3 Aylık 8.500 satıldı, 8.500 nakit alındı. 15.10 3 aylık satış "1 yıllığa çevrildi"
// diye iptal, 12 Aylık 19.500 satıldı ve bugün TEK PARÇA 19.500 nakit alındı; 17:16'da 06.10'daki 8.500
// ödeme de iptal edildi. Kasa defterinde böylece 06.10 −8.500, bugün +19.500 — ama gerçekte para 06.10'da
// 8.500, bugün 11.000 girdi. Toplam (19.500) zaten doğru; yanlış olan GÜNLER.
//
// Doğrusu: bugünün 19.500'ü iptal (`voidPayment`) → 12 aylık satışın borcu 19.500; sonra iki nakit tahsilat
// satışa açıkça: 06.10 8.500 (eski ödemenin saati korunuyor), 15.10 11.000 (bugünkü ödemenin saati).
// İptal edilmiş 06.10 ödemesi iptal olarak kalır (olay silinmez); yerine yenisi yazılır.
//
// KASA: 06.10 +8.500 (iptalden önceki hâline döner), bugün 19.500 → 11.000. Satış, paket, geçerlilik
// (06.10.2026 → 06.10.2027) değişmiyor.

const STUDIO = 'retro'
const BRANCH = 'mutlukent'
const RUN = 'fix-sevim-aygun-odemeler-2026-10-15'
const APPLY = process.argv.includes('--apply')

const VAKA = {
  memberId: 'mem_01M481TEQ91BM0MTJ6XB0V6V5V',
  saleId: 'sal_01M4ZKW57RVH97AT91KMWVB491',
  drawerId: 'drw_01KXGHV45ZJ91XCHHSNGN7A00H',
  iptal: 'pay_01M4ZKW57RVH97AT91KMWVB491',
  iptalKurus: 1_950_000,
  odemeler: [
    { id: `pay_${RUN}_1`, kurus: 850_000, at: 1_791_271_989_699, gun: '06.10.2026' },
    { id: `pay_${RUN}_2`, kurus: 1_100_000, at: 1_792_062_395_640, gun: '15.10.2026' },
  ],
} as const

const REASON =
  'Sevim Aygün Fitness 12 Aylık 19.500 ₺: 06.10 8.500 nakit (3 aylıktan çevrildi) + 15.10 11.000 nakit. ' +
  'Önceki kayıt (06.10 ödemesi iptal, bugün tek parça 19.500) günleri yanlış gösteriyordu (Işıl/owner, 2026-10-15).'

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
    const [satis, eski, ...yeni] = await Promise.all([doc('sales', VAKA.saleId), doc('payments', VAKA.iptal), ...VAKA.odemeler.map((o) => doc('payments', o.id))])
    return { satis, eski, yeni }
  }
  const d = await oku()
  if (!d.satis.exists || d.satis.get('memberId') !== VAKA.memberId || Number(d.satis.get('total.amount')) !== VAKA.iptalKurus) return dur('satış tanıdaki gibi değil.')
  if (!d.eski.exists || d.eski.get('memberId') !== VAKA.memberId || Number(d.eski.get('amount.amount')) !== VAKA.iptalKurus) return dur('bugünkü ödeme tanıdaki gibi değil.')

  console.log(`━━ SEVİM AYGÜN · satış ${d.satis.get('status')} · toplam ${tl(Number(d.satis.get('total.amount')))} · ödenen ${tl(Number(d.satis.get('paid.amount')))}`)
  console.log(`\n── ${APPLY ? 'UYGULANIYOR' : 'KURU ÇALIŞMA'} ──`)
  console.log(`   iptal : ${d.eski.id} · ${tl(VAKA.iptalKurus)} ${d.eski.get('method')}${d.eski.get('voided') ? ' — ZATEN İPTAL' : ''}`)
  VAKA.odemeler.forEach((o, i) => console.log(`   tahsil: ${o.gun} · ${tl(o.kurus)} nakit${d.yeni[i]!.exists ? ' — ZATEN VAR' : ''}`))
  console.log(`   sebep : ${REASON}`)
  if (!APPLY) { console.log('\n   --apply ile çalıştır.'); return }

  if (!d.eski.get('voided')) {
    const r = await voidPayment(fin, ctx, { paymentId: VAKA.iptal, reason: REASON })
    if (!r.ok) return dur(`iptal: ${JSON.stringify(r.error)}`)
    console.log(`   ✓ iptal ${VAKA.iptal}`)
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
  console.log(`\n✅ SON DURUM · satış ${s.satis.get('status')} · toplam ${tl(Number(s.satis.get('total.amount')))} · ödenen ${tl(Number(s.satis.get('paid.amount')))}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
