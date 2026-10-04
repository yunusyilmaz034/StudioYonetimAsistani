import {
  collect,
  FirestoreEntitlementRepository,
  FirestoreFinanceRepository,
  instant,
  money,
  systemClock,
  type BranchId,
  type MemberId,
  type TenantContext,
} from '@studio/core'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'

// MERVE PARLADI — PAYTR TAHSİLATI KAYDA GEÇMEDİ (owner onayı, 2026-10-04)
//
//   pnpm tsx tools/migration/fix-merve-parladi-paytr-tahsilat-2026-10-04.ts            (KURU)
//   pnpm tsx tools/migration/fix-merve-parladi-paytr-tahsilat-2026-10-04.ts --apply
//
// Owner: *"merve parladı bugün paytr üzerinden ödemesini yaptı ama borcu düşmedi, tam ödeme aldık
// aslında paytr panelde gördük."* → *"onay, da sakın üyeyi alacaklı bırakma."*
//
// ── NE OLDU (ölçüldü) ───────────────────────────────────────────────────────────────────────
//
// Ödeme linkinin intent'i, ödeme gelmeden ÖNCE süresi dolmuş: `status: expired`,
// `failureReason: timeout`. PAYTR 4 Ekim 07:03:34Z'de "success" diye çağırdı, imza DOĞRULANDI —
// ama `decideCallbackResult`un ilk kuralı "intent zaten terminal" deyip hiçbir şey yazmadan
// döndü. Hiçbir log satırı da bırakmadı: ne "intent yok" uyarısı, ne "completion failed" hatası.
// Para PAYTR'da, bizde kayıt yok.
//
// Koddaki break-glass ucu burada İŞLEMEZ: o da aynı `completePaidIntent`i çağırıyor ve aynı ilk
// kurala takılıyor. Bu yüzden düzeltme buradan, kayıtlı bir telafi olarak yapılıyor.
//
// ── TUTAR: 14.000 ₺, 15.401,54 ₺ DEĞİL ──────────────────────────────────────────────────────
//
// PAYTR 1.540.154 kuruş çekti; satışın değeri 1.400.000. Fark bankanın TAKSİT KOMİSYONU ve
// müşterinin ödediği şey — stüdyonun cirosu değil, stüdyoya hiç gelmiyor. Onu ciro yazmak,
// olmayan bir geliri deftere koymak olurdu (callback'in kendi kuralı da aynısını söylüyor:
// "The Payment recorded downstream stays intent.amount").
//
// ── TARİH: paranın GERÇEKTEN geçtiği an ─────────────────────────────────────────────────────
//
// `receivedAt` = callback'in geldiği an (4 Ekim 07:03:34Z = 10:03 TRT). "Bugün" yazmak kolaydı
// ama Burcu/Melisa/Duygu vakalarının üçü de yanlış tarihten çıktı; tarih cironun hangi güne
// yazıldığını belirler, tahmin edilecek bir alan değil.
//
// ── ÖDEME KİMLİĞİ: callback'in kullanacağı kimliğin AYNISI ──────────────────────────────────
//
// `pay_${providerRef.slice(0,20)}` — callback'in attributed-collection dalındaki birebir aynı
// formül. Böylece PAYTR bir gün aynı bildirimi tekrar gönderirse ikinci bir tahsilat doğmaz.
//
// ── ÜYEYİ ALACAKLI BIRAKMA (owner'ın şartı) ─────────────────────────────────────────────────
//
// Borcu sıfırlamak YETMEZ: ödediği hizmeti de almış olması lazım. Betik paketlerini önce okuyor
// ve bu satışın paketi yoksa UYGULAMAYI REDDEDİYOR — çünkü o hâlde yapılacak iş tahsilat değil,
// tahsilat + paket, ve paket vermek ayrı bir karardır.

const STUDIO = 'retro'
const BRANCH = 'mutlukent' as BranchId
const RUN = 'fix-merve-parladi-paytr-tahsilat-2026-10-04'
const APPLY = process.argv.includes('--apply')

const VAKA = {
  ad: 'MERVE PARLADI',
  memberId: 'mem_01M40Z9RPZMFZ5YWT6RQH8C1B4' as MemberId,
  saleId: 'sal_01M410EQXCZVC3G9BP5DJX1D8W',
  urun: 'Fitness - 6 Aylık',
  productId: 'prd_01KXJD2D1EMQRC6C0RD777VG2Y',
  netKurus: 1_400_000,
  paytrCektiKurus: 1_540_154,
  providerRef: '3b39bd221191479bb1e7ea0d71088a8f',
  odemeAniIso: '2026-10-04T07:03:34.000Z',
} as const

const REASON =
  'PAYTR ödeme linkinin süresi ödeme gelmeden dolduğu için callback tahsilatı sessizce attı; ' +
  'PAYTR panelinde doğrulanan ödeme kayda geçirildi (owner onayı, 2026-10-04).'

const tl = (k: number) => `${(k / 100).toLocaleString('tr-TR')} ₺`
const an = (v: unknown): string =>
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

  const paymentId = `pay_${VAKA.providerRef.slice(0, 20)}`

  // ── MEVCUT HÂL ────────────────────────────────────────────────────────────────────────────
  const satis = await db.doc(`studios/${STUDIO}/sales/${VAKA.saleId}`).get()
  if (!satis.exists) { console.error('DUR: satış bulunamadı.'); process.exit(1) }
  const varOlanOdeme = await db.doc(`studios/${STUDIO}/payments/${paymentId}`).get()

  console.log(`━━ ${VAKA.ad}`)
  console.log(`   satış  : ${tl(Number(satis.get('total.amount')))} · ${satis.get('status')} · ödenen ${tl(Number(satis.get('paid.amount')))} · ${an(satis.get('soldAt'))}`)
  console.log(`   PAYTR  : çekti ${tl(VAKA.paytrCektiKurus)} · deftere yazılacak ${tl(VAKA.netKurus)} · fark ${tl(VAKA.paytrCektiKurus - VAKA.netKurus)} = banka taksit komisyonu (ciro DEĞİL)`)
  console.log(`   ödeme  : ${paymentId} → ${varOlanOdeme.exists ? 'ZATEN VAR' : 'yok'}`)

  // ── ÜYEYİ ALACAKLI BIRAKMA: paketi var mı ─────────────────────────────────────────────────
  const paketler = await new FirestoreEntitlementRepository(db).listByMember(ctx, VAKA.memberId)
  console.log(`\n━━ PAKETLERİ (${paketler.length})`)
  for (const e of paketler) {
    console.log(`   ${e.productSnapshot.name} · ${e.status} · ürün=${e.productId} · ${new Date(e.validFrom as number).toLocaleDateString('tr-TR')} → ${new Date(e.validUntil as number).toLocaleDateString('tr-TR')}`)
  }
  const buPaket = paketler.filter((e) => e.productId === VAKA.productId)
  console.log(`   bu satışın paketi (${VAKA.urun}): ${buPaket.length > 0 ? `VAR · ${buPaket.map((e) => e.status).join(', ')}` : 'YOK'}`)

  // ── KORUMALAR ─────────────────────────────────────────────────────────────────────────────
  if (satis.get('status') !== 'open') { console.error(`DUR: satış 'open' değil (${satis.get('status')}).`); process.exit(1) }
  if (Number(satis.get('total.amount')) !== VAKA.netKurus) { console.error('DUR: satış tutarı beklenenden farklı.'); process.exit(1) }
  if (Number(satis.get('paid.amount')) !== 0) { console.error('DUR: satışa zaten ödeme işlenmiş.'); process.exit(1) }
  if (varOlanOdeme.exists) { console.log('DUR: bu tahsilat zaten kayıtlı — yapılacak bir şey yok.'); return }
  if (buPaket.length === 0) {
    console.error(
      '\nDUR: ÜYE ALACAKLI KALIR. Bu satışın paketi oluşmamış; sadece tahsilat yazmak borcu\n' +
      '     sıfırlar ama ödediği hizmeti vermez. Yapılacak iş tahsilat + paket, ve paket vermek\n' +
      '     ayrı bir karar — owner\'a sorulmadan yapılmaz.',
    )
    process.exit(2)
  }

  if (!APPLY) {
    console.log(`\n── KURU ÇALIŞMA ── uygulanacak olan:`)
    console.log(`   tahsilat ${tl(VAKA.netKurus)} · yöntem online · kasa yok`)
    console.log(`   tarih    ${new Date(VAKA.odemeAniIso).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' })}`)
    console.log(`   tahsis   ${VAKA.saleId} (${VAKA.urun})`)
    console.log(`   sebep    ${REASON}`)
    console.log(`\n   --apply ile çalıştır.`)
    return
  }

  const res = await collect(
    { repo: new FirestoreFinanceRepository(db), clock: systemClock },
    ctx,
    {
      paymentId,
      memberId: VAKA.memberId,
      branchId: BRANCH,
      amount: money(VAKA.netKurus),
      method: 'online',
      receivedAt: instant(new Date(VAKA.odemeAniIso).getTime()),
      drawerId: null,
      giftCardCode: null,
      note: REASON,
      allowNoDrawer: true,
      // OR-37 — bu para BU satışa aittir, en eski borca değil.
      allocateTo: [{ saleId: VAKA.saleId, amount: money(VAKA.netKurus), allocationId: `${paymentId}_a0` }],
    },
  )
  if (!res.ok) { console.error('DUR: tahsilat reddedildi →', JSON.stringify(res.error)); process.exit(1) }

  const sonra = await db.doc(`studios/${STUDIO}/sales/${VAKA.saleId}`).get()
  console.log(`\n✅ UYGULANDI`)
  console.log(`   satış: ${sonra.get('status')} · ödenen ${tl(Number(sonra.get('paid.amount')))} / ${tl(Number(sonra.get('total.amount')))}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
