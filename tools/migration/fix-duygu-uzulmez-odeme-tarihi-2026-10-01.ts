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

// DUYGU ÜZÜLMEZ — PAKET 16 EYLÜL'DE ALINDI, PARA BUGÜN ÖDENDİ (owner, 2026-10-01).
//
//   pnpm tsx tools/migration/fix-duygu-uzulmez-odeme-tarihi-2026-10-01.ts
//   pnpm tsx tools/migration/fix-duygu-uzulmez-odeme-tarihi-2026-10-01.ts --apply
//
// Owner: *"Duygu Üzülmez bugün ödeme yaptı ama sistemde daha önce görünüyor, onu bugüne al."*
// Sorulduğunda netleşti: **satış 16 Eylül'de doğru**, yanlış olan yalnızca ödemenin günü. Yani
// kayıtlarda iki hafta borçlu görünecek — çünkü gerçekte öyleydi.
//
// ── NEDEN MELİSA'DAN FARKLI BİR YOL ─────────────────────────────────────────────────────────
//
// Melisa'da satış da ödeme de yanlış gündeydi, ikisi birden yeniden kuruldu. Burada satış DOĞRU
// tarihte. Onu yeniden kursaydım `soldAt` saatten gelir ve satış 16 Eylül'den bu geceye kayardı —
// yani bir yanlışı düzeltirken ikincisini yazardım. O yüzden satışa hiç dokunulmuyor: ödeme iptal
// ediliyor, aynı satışa BUGÜN yeni bir tahsilat yazılıyor (`allocateTo` ile hedefi açıkça
// verilerek — "en eski borca" kaymasın diye).
//
// ── KASA: OWNER'A SORULDU VE ONAYLANDI ──────────────────────────────────────────────────────
//
// Ödeme NAKİT ve bir kasaya bağlı. 11.000 ₺, 16 Eylül'ün kasasından çıkıp bugünün kasasına geçiyor:
// o günün gün sonu 11.000 ₺ azalıyor, bugünkü artıyor. 16 Eylül kapatılmış ve sayılmış bir gündü;
// bilerek değiştiriliyor (owner: *"evet, doğru"*).
//
// Kasa BAKİYESİ ise net sıfır değişiyor ve bu bir tesadüf değil: `voidPayment` nakit ödemenin
// kasasından −11.000 yazıyor, `collect` aynı kasaya +11.000. Kasa belgesi günler arasında yeniden
// kullanıldığı için bugünün sayımı bozulmuyor; değişen şey ödemenin TARİHİ, ve raporlar tarihe bakar.

const STUDIO = 'retro'
const BRANCH = 'mutlukent'
const RUN = 'fix-duygu-uzulmez-odeme-tarihi-2026-10-01'
const APPLY = process.argv.includes('--apply')
const REASON =
  'Paket 16 Eylül’de satıldı, parası 1 Ekim’de nakit ödendi; tahsilat yanlışlıkla satış günine ' +
  'yazılmıştı. Satış olduğu gibi bırakıldı, tahsilat doğru güne taşındı (owner onayı, 2026-10-01).'

const VAKA = {
  ad: 'DUYGU ÜZÜLMEZ',
  memberId: 'mem_01M2MY27NRSKX38SYW6DYPK1FT',
  saleId: 'sal_01M2MY2WF9A4QA0YWC254B0GBW',
  paymentId: 'pay_01M2MY2WF9A4QA0YWC254B0GBW',
  drawerId: 'drw_01KXGHV45ZJ91XCHHSNGN7A00H',
  tutarKurus: 1_100_000,
} as const

const tl = (k: number) => `${(k / 100).toLocaleString('tr-TR')} ₺`
const an = (t: unknown): string =>
  (t as { toDate?: () => Date })?.toDate?.()?.toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' }) ?? '—'

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

  const s = await db.doc(`studios/${STUDIO}/sales/${VAKA.saleId}`).get()
  const p = await db.doc(`studios/${STUDIO}/payments/${VAKA.paymentId}`).get()
  const k = await db.doc(`studios/${STUDIO}/cashDrawers/${VAKA.drawerId}`).get()
  const yeni = await db.doc(`studios/${STUDIO}/payments/pay_${RUN}`).get()

  console.log(`━━ ${VAKA.ad}`)
  console.log(`   satış : ${s.exists ? `${tl(Number(s.get('total.amount')))} · ${s.get('status')} · ${an(s.get('soldAt'))}  ← DOKUNULMAYACAK` : 'YOK'}`)
  console.log(`   ödeme : ${p.exists ? `${tl(Number(p.get('amount.amount')))} · ${p.get('method')} · kasa=${p.get('drawerId')} · ${an(p.get('receivedAt'))}` : 'YOK'}`)
  console.log(`   kasa  : ${k.exists ? `${k.get('name')} · ${k.get('status')}` : 'YOK'}`)
  console.log(`   HEDEF : aynı satışa, bugün tarihli ${tl(VAKA.tutarKurus)} nakit tahsilat\n`)

  if (!s.exists || !p.exists) { console.error('DUR: satış ya da ödeme yok.'); process.exit(1) }
  if (s.get('status') === 'cancelled') { console.error('DUR: satış iptal edilmiş.'); process.exit(1) }
  if (p.get('voided') === true) { console.log('DUR: ödeme zaten iptal — düzeltme uygulanmış olabilir.'); return }
  if (p.get('method') !== 'cash') { console.error(`DUR: ödeme nakit değil (${p.get('method')}) — kasa etkisi başka.`); process.exit(1) }
  if (Number(p.get('amount.amount')) !== VAKA.tutarKurus) { console.error('DUR: ödeme tutarı beklenenden farklı.'); process.exit(1) }
  if (Number(s.get('total.amount')) !== VAKA.tutarKurus) { console.error('DUR: satış tutarı beklenenden farklı.'); process.exit(1) }
  // Nakit tahsilat AÇIK bir kasa ister. Kapalıysa `allowNoDrawer` ile kasasız yazmak teknik olarak
  // mümkün ama burada yanlış olur: para bugün kasaya girdi, kaydı da öyle demeli.
  if (!k.exists || k.get('status') !== 'open') { console.error('DUR: kasa açık değil — önce kasayı açın.'); process.exit(1) }
  if (yeni.exists) { console.log('DUR: düzeltme zaten uygulanmış.'); return }
  if (!APPLY) { console.log('(uygulamak için --apply)'); return }

  console.log('── UYGULANIYOR ──')
  const vo = await voidPayment(fin, ctx, { paymentId: VAKA.paymentId, reason: REASON })
  if (!vo.ok) { console.error('ÖDEME İPTALİ BAŞARISIZ:', vo.error); process.exit(1) }

  const now = Date.now()
  const co = await collect(fin, ctx, {
    paymentId: `pay_${RUN}`,
    memberId: VAKA.memberId as MemberId,
    branchId: BRANCH as BranchId,
    amount: money(VAKA.tutarKurus),
    method: 'cash',
    receivedAt: instant(now),
    drawerId: VAKA.drawerId,
    giftCardCode: null,
    note: REASON,
    // Hedef AÇIKÇA veriliyor: boş bırakılsa "en eski borç" kuralı işler ve para başka bir satışa
    // gidebilirdi (OR-37).
    allocateTo: [{ saleId: VAKA.saleId, amount: money(VAKA.tutarKurus), allocationId: `alc_${RUN}` }],
  })
  if (!co.ok) { console.error('TAHSİLAT BAŞARISIZ:', co.error); process.exit(1) }
  if (co.value.unallocated > 0) console.warn(`UYARI: ${tl(co.value.unallocated)} tahsis edilemedi.`)

  console.log(`✓ ${tl(VAKA.tutarKurus)} nakit, bugün tarihiyle, 16 Eylül’deki satışa yazıldı. Satış tarihi değişmedi.`)
}

void main()
