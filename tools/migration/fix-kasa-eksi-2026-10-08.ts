import {
  FirestoreFinanceRepository,
  mintedAt,
  voidReachesDrawer,
  type TenantContext,
} from '@studio/core'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'

// MERKEZ KASA −12.000 ₺ — BUGÜNÜN OTURUMUNA YANLIŞ YAZILAN İPTALİ GERİ AL (owner, 2026-10-08)
//
//   pnpm tsx tools/migration/fix-kasa-eksi-2026-10-08.ts            # kuru çalışma
//   pnpm tsx tools/migration/fix-kasa-eksi-2026-10-08.ts --apply    # yaz
//
// Owner: *"dün 2 ödeme yanlış kaydedilmişti, sildim. Dünden düşmüş, tamam — bugünden de düşmüş,
// yanlış."* ve sonra: *"düzelt + kuralı değiştir."*
//
// Tanı (`tani-kasa-eksi-2026-10-08.ts`): 7 Ekim 20:33'te girilen 12.000 ₺ nakit, 8 Ekim 12:27'de
// iptal edildi. Kasa her sabah sıfırdan açılan TEK belge; iptal tutarı o belgeden düştü, yani o
// parayı hiç görmemiş bugünkü oturumdan. Eksi kasa kapatılamaz (`counted` sıfırın altına inemez):
// 23:00 otomatik gün sonu reddedilir ve eksi yarına taşınırdı.
//
// Kural aynı commit'te değişti (`voidReachesDrawer`): bir iptal yalnızca paranın konduğu oturuma
// dokunur. Bu betik, kural değişmeden ÖNCE yazılmış tek yanlış hareketi geri alır.
//
// ── NEDEN OLAY YAZMIYOR ─────────────────────────────────────────────────────────────────────
//
// `expected` bir olgu değil, TÜREVDİR: "açılış + giren − çıkan", ekran için saklanan bir toplam
// (`types.ts`). Burada yeni bir şey olmuyor — toplam, kendi tanımının verdiği sayıya geri çekiliyor.
// Olan şeyin kaydı zaten günlükte: `payment.voided`, tutarı ve sebebiyle. Bu düzeltme için uydurma
// bir olay yazmak, kasaya hiç girmemiş 12.000 ₺'lik bir "giriş" iddia etmek olurdu.
//
// ── NEDEN İKİ KEZ ÇALIŞTIRILAMAZ ────────────────────────────────────────────────────────────
//
// Sayı ezbere yazılmıyor: oturumun tanımdan hesaplanan toplamı ile kasadaki toplam karşılaştırılıyor.
// Aradaki fark TAM OLARAK bu iptalse düzeltilir; fark yoksa zaten düzelmiştir; başka bir şeyse durur.

const STUDIO = 'retro'
const BRANCH = 'mutlukent'
const RUN = 'fix-kasa-eksi-2026-10-08'
const APPLY = process.argv.includes('--apply')

const DRAWER = 'drw_01KXGHV45ZJ91XCHHSNGN7A00H'
const PAYMENT = 'pay_01M4BPSYSHPXGDHMM9KNG5FZ8K'

const tl = (k: number) => `${(k / 100).toLocaleString('tr-TR')} ₺`
const ms = (v: unknown): number => (v instanceof Timestamp ? v.toMillis() : Number(v ?? 0))
const an = (v: number) => new Date(v).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' })

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
  const repo = new FirestoreFinanceRepository(db)
  const col = (n: string) => db.collection(`studios/${STUDIO}/${n}`)
  const dur = (m: string): never => { console.error(`DUR: ${m}`); process.exit(1) }

  const [drawer, payment] = await Promise.all([repo.getDrawer(ctx, DRAWER), repo.getPayment(ctx, PAYMENT)])
  if (!drawer || !payment) return dur('kasa ya da ödeme yok.')
  if (drawer.status !== 'open' || drawer.openedAt === null) return dur('kasa açık değil — düzeltilecek oturum kapanmış.')
  const acilis = drawer.openedAt as number
  if (!payment.voided || payment.method !== 'cash' || payment.drawerId !== DRAWER) dur('ödeme beklenen durumda değil.')
  const girildi = mintedAt(payment.id)
  if (girildi === null || girildi >= acilis) dur('ödeme bu oturumda girilmiş — iptalin kasadan düşmesi doğru.')
  // Yeni kuralın kendisi de aynı şeyi söylemeli: bu ödemenin iptali bu oturuma DOKUNMAZ.
  if (voidReachesDrawer({ ...payment, voided: false }, drawer)) dur('kural bu iptali oturuma yazıyor — beklenmeyen.')

  // ── OTURUMUN TANIMDAN TOPLAMI ──
  const [odemeler, cikislar, iadeler, olaylar] = await Promise.all([
    col('payments').where('drawerId', '==', DRAWER).get(),
    col('cashOutflows').where('drawerId', '==', DRAWER).get(),
    col('refunds').where('drawerId', '==', DRAWER).get(),
    col('events').where('occurredAt', '>=', Timestamp.fromMillis(acilis)).get(),
  ])
  // Cüzdan yüklemesi de kasaya girer ama ödeme belgesi bırakmaz; bu oturumda varsa elle bakılmalı.
  const cuzdan = olaylar.docs.filter((o) => String(o.get('type')).startsWith('wallet.'))
  if (cuzdan.length > 0) dur(`bu oturumda ${cuzdan.length} cüzdan hareketi var — toplam elle doğrulanmalı.`)

  const giren = odemeler.docs
    .filter((p) => p.get('voided') !== true && (mintedAt(p.id) ?? ms(p.get('receivedAt'))) >= acilis)
    .reduce((n, p) => n + Number(p.get('amount.amount')), 0)
  const cikan = cikislar.docs
    .filter((o) => o.get('voided') !== true && ms(o.get('occurredAt')) >= acilis)
    .reduce((n, o) => n + Number(o.get('amount.amount')), 0)
  const iade = iadeler.docs.filter((r) => ms(r.get('at')) >= acilis).reduce((n, r) => n + Number(r.get('amount.amount')), 0)
  const tanim = drawer.openingFloat.amount + giren - cikan - iade
  const fark = tanim - drawer.expected.amount

  console.log(`━━ ${drawer.name} · açılış ${an(acilis)}`)
  console.log(`   açılış ${tl(drawer.openingFloat.amount)} + giren ${tl(giren)} − çıkan ${tl(cikan)} − iade ${tl(iade)} = ${tl(tanim)}`)
  console.log(`   kasada yazan: ${tl(drawer.expected.amount)} · fark ${tl(fark)}`)
  console.log(`   yanlış yazılan iptal: ${PAYMENT} · ${tl(payment.amount.amount)} · girildiği an ${an(girildi!)}`)

  if (fark === 0) { console.log('\nDUR: zaten düzeltilmiş.'); return }
  if (fark !== payment.amount.amount) dur('fark bu iptalin tutarına eşit değil — başka bir şey var, dokunulmadı.')

  if (!APPLY) {
    console.log(`\n── KURU ÇALIŞMA ── kasa ${tl(drawer.expected.amount)} → ${tl(tanim)}\n   --apply ile çalıştır.`)
    return
  }
  await repo.commit(ctx, { drawerDeltas: [{ drawerId: DRAWER, deltaKurus: fark }], events: [] })
  const son = await repo.getDrawer(ctx, DRAWER)
  console.log(`\n✅ UYGULANDI — kasa şimdi ${tl(son!.expected.amount)}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
