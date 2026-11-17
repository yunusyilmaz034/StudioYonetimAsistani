import {
  FirestoreEntitlementRepository,
  FirestoreFinanceRepository,
  amendEntitlement,
  cancelEntitlement,
  cancelSale,
  instant,
  systemClock,
  type EntitlementId,
  type FinanceDeps,
  type TenantContext,
} from '@studio/core'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

// FERDA YALÇINKAYA — ÇİFT 12 AYLIK (owner, 2026-11-17: "bir önceki paketi, bakiyesi açık olanı iptal et, borcu da kalmasın").
//
//   pnpm tsx tools/migration/ferda-yalcinkaya-cift-paket-2026-11-17.ts [--apply]
//
// 16.11 14:59 masada 12 Aylık satıldı, ÖDENMEDİ (22.000 ₺ borç, paket 16.11.2026→16.11.2027). 17.11 13:10 üye aynı
// paketi online aldı ve ÖDEDİ; sistem ikinci paketi birincinin arkasına kuyrukladı (16.11.2027→15.11.2028).
// Yalnız açık satışı iptal etmek ödenen paketi bir yıl sonraya bırakırdı. Üç adım, hepsi sebepli:
//   1 · ödenmemiş paket iptal  2 · ödenmemiş satış iptal (borç kalkar)  3 · ödenen paket 16.11.2026→16.11.2027'ye çekilir.

const STUDIO = 'retro'
const RUN = 'ferda-yalcinkaya-cift-paket-2026-11-17'
const UYE = 'mem_01M005X1RJ9FTP54R07N6M3R7T'
const ACIK_SATIS = 'sal_01M7J3M4HQCVG7A3S5VQ39NZTE'
const ACIK_PAKET = 'ent_01M7J3M4HRSAFSX956Q0RQH6AA'
const ODENEN_PAKET = 'ent_01M7MFSAR99MH1TCXNWZZTX0XC'
const SEBEP = 'Mükerrer 12 Aylık: üye 17.11 aynı paketi online alıp ödedi; ödenmemiş 16.11 satışı iptal (owner, 17.11.2026).'
const SEBEP_TARIH = 'Mükerrer satış iptal edildi; ödenen paket ilk paketin yerine 16.11.2026 başlar (owner, 17.11.2026).'

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply')
  initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID ?? 'studio-yonetim-prod' })
  const db = getFirestore()
  const ctx = { studioId: STUDIO, actor: { type: 'platform_admin', id: `migration:${RUN}` }, branchIds: ['mutlukent'], correlationId: RUN, source: 'migration', role: 'platform_admin' } as unknown as TenantContext
  const entRepo = new FirestoreEntitlementRepository(db)
  const deps: FinanceDeps = { repo: new FirestoreFinanceRepository(db), clock: systemClock, source: 'migration' }
  const dur = (m: string): never => { console.error(`DUR: ${m}`); process.exit(1) }
  const d = (ms: number) => new Date(ms).toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul' })

  const sale = await deps.repo.getSale(ctx, ACIK_SATIS)
  if (!sale || String(sale.memberId) !== UYE || sale.status !== 'open' || sale.paid.amount !== 0 || sale.total.amount !== 2_200_000) return dur('açık satış beklenen durumda değil')
  const acik = await entRepo.getEntitlement(ctx, ACIK_PAKET as EntitlementId)
  const odenen = await entRepo.getEntitlement(ctx, ODENEN_PAKET as EntitlementId)
  if (!acik || acik.status !== 'active' || String(acik.memberId) !== UYE) return dur('ödenmemiş paket beklenen durumda değil')
  if (!odenen || odenen.status !== 'active' || String(odenen.memberId) !== UYE) return dur('ödenen paket beklenen durumda değil')
  const from = Number(acik.validFrom)
  const until = Number(acik.validUntil)

  console.log(apply ? '── UYGULANIYOR ──' : '── KURU ÇALIŞMA ──')
  console.log(`1 · paket iptal : ${ACIK_PAKET} (${d(from)}→${d(until)})`)
  console.log(`2 · satış iptal : ${ACIK_SATIS} 22.000 ₺, ödenen 0 → borç kalkar`)
  console.log(`3 · ödenen paket: ${d(Number(odenen.validFrom))}→${d(Number(odenen.validUntil))}  ⇒  ${d(from)}→${d(until)}`)
  if (!apply) return console.log('\nkuru çalışma — hiçbir şey yazılmadı')

  const c = await cancelEntitlement({ repo: entRepo, clock: systemClock } as never, ctx, { entitlementId: ACIK_PAKET as EntitlementId, reason: SEBEP, refundPaymentId: null })
  if (!c.ok) return dur(`paket iptal: ${JSON.stringify(c.error)}`)
  console.log('✅ ödenmemiş paket iptal')
  const s = await cancelSale(deps, ctx, { saleId: ACIK_SATIS, reason: SEBEP })
  if (!s.ok) return dur(`satış iptal: ${JSON.stringify(s.error)}`)
  console.log('✅ ödenmemiş satış iptal — borç kalktı')
  const a = await amendEntitlement({ repo: entRepo, clock: systemClock }, ctx, { entitlementId: ODENEN_PAKET as EntitlementId, patch: { validFrom: instant(from), validUntil: instant(until) }, reason: SEBEP_TARIH })
  if (!a.ok) return dur(`ödenen paket tarihi: ${JSON.stringify(a.error)}`)
  console.log(`✅ ödenen paket ${d(from)}→${d(until)}`)
  process.exit(0)
}
void main().catch((e) => { console.error(e); process.exit(1) })
