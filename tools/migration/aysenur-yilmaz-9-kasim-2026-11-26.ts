import {
  FirestoreFinanceRepository,
  collect,
  instant,
  money,
  newOperationId,
  systemClock,
  type BranchId,
  type FinanceDeps,
  type MemberId,
  type TenantContext,
} from '@studio/core'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

// AYŞENUR YILMAZ — FITNESS 3 AYLIK'IN KALAN 4.500 ₺'Sİ 9.11.2026'DA ALINMIŞ, SİSTEME GİRİLMEMİŞ (owner, 2026-11-26;
// resepsiyon: "ödendi ayın 9'da … deftere yazmışız, sistemde yok, kamerandan baktım").
//   node_modules/.bin/tsx tools/migration/aysenur-yilmaz-9-kasim-2026-11-26.ts [--apply]
// Yöntem NAKİT (önceki dört ödemesi de nakit, paket kartı "Nakit"); an = 9.11 turnike girişi 18:54 (İstanbul);
// Merkez Kasa; satışa bağlı → satış kapanır, borç 0. Pano/kasa 9.11'e düşer (ödeme `receivedAt` taşır).
const STUDIO = 'retro'
const RUN = 'aysenur-yilmaz-9-kasim-2026-11-26'
const UYE = 'mem_01M2JJT7XJQ8G0YX49HDQA7R13'
const SATIS = 'sal_01M6RQG50FME2C3T1YQTG34BFX'
const KASA = 'drw_01KXGHV45ZJ91XCHHSNGN7A00H' // Merkez Kasa
const TUTAR = 450_000
const AN = Date.parse('2026-11-09T15:54:09Z')
const NOT = '9.11.2026 nakit — deftere yazılmış, sisteme girilmemiş (owner, 26.11.2026)'

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply')
  initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID ?? 'studio-yonetim-prod' })
  const db = getFirestore()
  const ctx = { studioId: STUDIO, actor: { type: 'platform_admin', id: `migration:${RUN}` }, branchIds: ['mutlukent'], correlationId: RUN, source: 'migration', role: 'platform_admin' } as unknown as TenantContext
  const deps: FinanceDeps = { repo: new FirestoreFinanceRepository(db), clock: systemClock, source: 'migration' }
  const dur = (m: string): never => { console.error(`DUR: ${m}`); process.exit(1) }

  const sale = await deps.repo.getSale(ctx, SATIS)
  if (!sale || sale.memberId !== UYE || sale.status !== 'open' || sale.total.amount !== 850_000 || sale.paid.amount !== 400_000) return dur('satış beklenen durumda değil')
  console.log(apply ? '── UYGULANIYOR ──' : '── KURU ÇALIŞMA ──')
  console.log(`${SATIS} "${sale.lines[0]?.description}" 8.500 / ödenen 4.000 → +4.500 nakit (${new Date(AN).toISOString()}, Merkez Kasa)`)
  if (!apply) return console.log('\nkuru çalışma — hiçbir şey yazılmadı')

  const op = newOperationId().slice(4)
  const r = await collect(deps, ctx, {
    paymentId: `pay_${op}`, memberId: UYE as MemberId, branchId: sale.branchId as BranchId, amount: money(TUTAR), method: 'cash',
    receivedAt: instant(AN), drawerId: KASA, allowNoDrawer: false, giftCardCode: null, note: NOT,
    allocateTo: [{ saleId: SATIS, amount: money(TUTAR), allocationId: `alc_${op}` }],
  })
  if (!r.ok) return dur(`tahsilat: ${JSON.stringify(r.error)}`)
  const after = await deps.repo.getSale(ctx, SATIS)
  console.log(`✅ pay_${op}: satış ${after?.status} · ödenen ${after?.paid.amount}`)
  process.exit(0)
}
void main().catch((e) => { console.error(e); process.exit(1) })
