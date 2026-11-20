import {
  FirestoreCatalogRepository,
  FirestoreEntitlementRepository,
  FirestoreFinanceRepository,
  amendEntitlement,
  cancelSale,
  createProduct,
  money,
  newOperationId,
  sell,
  systemClock,
  voidPayment,
  type BranchId,
  type EntitlementId,
  type FinanceDeps,
  type MemberId,
  type ServiceId,
  type TenantContext,
} from '@studio/core'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

// "FITNESS - 7 AYLIK" — HER YERDE KAPALI, 15.500 ₺ — VE ZÜLEYHA TANIŞ'A ATAMA (owner, 2026-11-20: "her yerde kapalı 7 aylık
// paket yapsan 15500 tl yapsan bu kadına atasan").
//
//   pnpm tsx tools/migration/zuleyha-tanis-7-aylik-urun-2026-11-20.ts [--apply]
//
// 1 · katalog: "Fitness - 7 Aylık", fitness, 210 gün, 15.500 ₺ (nakit = kart), dondurma 14 gün, 6 Aylık'ın hizmetleri;
//     online satış / üye uygulaması / AI fiyatı KAPALI. Masada satılabilir (aktif) — owner kapatmak isterse Paketler'den.
// 2 · paket: ürün kaydı 7 Aylık'a (amend); tarihler (24.11.2026→23.06.2027) ve 15.500 aynı kalır.
// 3 · satış: "Fitness - 6 Aylık" 15.500 satırı + 15.500 KK iptal (sebepli) → "Fitness - 7 Aylık" 15.500 + aynı KK, aynı an.

const STUDIO = 'retro'
const RUN = 'zuleyha-tanis-7-aylik-urun-2026-11-20'
const ALTI_AYLIK = 'prd_01KXJD2D1EMQRC6C0RD777VG2Y'
const SATIS = 'sal_01M7WQ2ZWNRYK75J1PBXE0S1H9'
const PAKET = 'ent_01M7WEZRACB01JC0K7YBM9JQRA'
const TUTAR = 1_550_000
const SEBEP = 'Paket 7 aylık satıldı; katalogda (gizli) "Fitness - 7 Aylık" açıldı, satış ve paket ona alındı (owner, 20.11.2026).'

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply')
  initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID ?? 'studio-yonetim-prod' })
  const db = getFirestore()
  const ctx = { studioId: STUDIO, actor: { type: 'platform_admin', id: `migration:${RUN}` }, branchIds: ['mutlukent'], correlationId: RUN, source: 'migration', role: 'platform_admin' } as unknown as TenantContext
  const deps: FinanceDeps = { repo: new FirestoreFinanceRepository(db), clock: systemClock, source: 'migration' }
  const entRepo = new FirestoreEntitlementRepository(db)
  const catRepo = new FirestoreCatalogRepository(db)
  const dur = (m: string): never => { console.error(`DUR: ${m}`); process.exit(1) }

  const alti = await catRepo.getProduct(ctx, ALTI_AYLIK as never)
  const sale = await deps.repo.getSale(ctx, SATIS)
  const ent = await entRepo.getEntitlement(ctx, PAKET as EntitlementId)
  if (!alti || alti.name !== 'Fitness - 6 Aylık') return dur('6 Aylık ürün yok')
  if ((await db.collection(`studios/${STUDIO}/products`).where('name', '==', 'Fitness - 7 Aylık').get()).size) return dur('"Fitness - 7 Aylık" zaten var')
  if (!sale || sale.status !== 'settled' || sale.total.amount !== TUTAR) return dur('satış beklenen durumda değil')
  if (!ent || ent.status !== 'active' || ent.priceAgreed.amount !== TUTAR) return dur('paket beklenen durumda değil')
  const pay = (await deps.repo.listPaymentsByMember(ctx, sale.memberId as MemberId)).find((x) => !x.voided && x.amount.amount === TUTAR)
  if (!pay) return dur('15.500 KK ödeme bulunamadı')
  console.log(apply ? '── UYGULANIYOR ──' : '── KURU ÇALIŞMA ──')
  console.log('ürün  : "Fitness - 7 Aylık" 210 gün 15.500 ₺ — online/üye/AI kapalı')
  console.log(`paket : ${PAKET} ürünü → 7 Aylık (tarih/tutar aynı)`)
  console.log(`satış : ${SATIS} + ${pay.id} iptal → "Fitness - 7 Aylık" 15.500 + KK`)
  if (!apply) return console.log('\nkuru çalışma — hiçbir şey yazılmadı')

  const pr = await createProduct({ repo: catRepo, clock: systemClock } as never, ctx, {
    name: 'Fitness - 7 Aylık', category: alti.category, serviceIds: alti.serviceIds as readonly ServiceId[], type: 'period',
    durationDays: 210, creditCount: null, priceInKurus: TUTAR, cashPriceInKurus: null, freezeAllowanceDays: alti.freezeAllowanceDays,
    dailyReservationLimit: null, cancellationAllowanceCount: null, activeReservationLimit: null, entryAllowance: null, components: null,
    description: '', onlineSellable: false, memberSellable: false, aiQuotable: false,
  })
  if (!pr.ok) return dur(`ürün: ${JSON.stringify(pr.error)}`)
  const yeni = pr.value.productId
  console.log(`✅ ürün ${yeni}`)

  const a = await amendEntitlement({ repo: entRepo, clock: systemClock }, ctx, {
    entitlementId: PAKET as EntitlementId,
    patch: { productSnapshot: { ...ent.productSnapshot, productId: yeni, name: 'Fitness - 7 Aylık', grant: { kind: 'period', durationDays: 210, access: 'unlimited' }, listPrice: money(TUTAR) } as never },
    reason: SEBEP,
  })
  if (!a.ok) return dur(`paket: ${JSON.stringify(a.error)}`)
  console.log('✅ paket 7 Aylık')

  const v = await voidPayment(deps, ctx, { paymentId: pay.id, reason: SEBEP })
  if (!v.ok) return dur(`ödeme iptal: ${JSON.stringify(v.error)}`)
  const c = await cancelSale(deps, ctx, { saleId: SATIS, reason: SEBEP })
  if (!c.ok) return dur(`satış iptal: ${JSON.stringify(c.error)}`)
  const line = sale.lines[0]!
  const op = newOperationId().slice(4)
  const s = await sell(deps, ctx, {
    saleId: `sal_${op}`, memberId: sale.memberId as MemberId, branchId: sale.branchId as BranchId, soldAt: sale.soldAt,
    lines: [{ ...line, productId: yeni as never, description: 'Fitness - 7 Aylık', unitPrice: money(TUTAR), entitlementId: PAKET as never }],
    discounts: [], discountCeilingPercent: null,
    payment: { paymentId: `pay_${op}`, allocationId: `alc_${op}`, amount: money(TUTAR), method: 'credit_card', receivedAt: pay.receivedAt, drawerId: pay.drawerId, giftCardCode: null, note: null, allowNoDrawer: pay.drawerId == null },
  })
  if (!s.ok) return dur(`yeni satış: ${JSON.stringify(s.error)}`)
  console.log(`✅ satış "Fitness - 7 Aylık" 15.500 + KK: ${s.value.saleId}`)
  process.exit(0)
}
void main().catch((e) => { console.error(e); process.exit(1) })
