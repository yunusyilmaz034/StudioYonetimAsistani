import {
  FirestoreEntitlementRepository,
  FirestoreFinanceRepository,
  amendEntitlement,
  cancelSale,
  money,
  newOperationId,
  sell,
  systemClock,
  voidPayment,
  type BranchId,
  type EntitlementId,
  type FinanceDeps,
  type MemberId,
  type TenantContext,
} from '@studio/core'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

// ZÜLEYHA TANIŞ — 7 AYLIK, TEK SATIŞ 15.500 ₺ (owner, 2026-11-20: "kart taksit farkı diye ekleme … 6 ay değil 7 aylık
// istemiş, bitiş tarihini uzatmış resepsiyon ve 1500 fazla almış").
//
//   pnpm tsx tools/migration/zuleyha-tanis-7-aylik-2026-11-20.ts [--apply]
//
// `zuleyha-tanis-taksit-farki-2026-11-20.ts` yanlış yorumdu (ayrı "Kart taksit farkı" satışı). Doğrusu: paket
// (24.11.2026→23.06.2027, resepsiyon 7 aya uzatmış) TEK satış, 15.500 ₺, 15.500 KK ödemeyle kapalı. Telafi:
//   1 · iptal: 15.500 KK ödeme, "Kart taksit farkı" satışı, 14.000 paket satışı (sebepli)
//   2 · aynı paket satırı 15.500 ₺, aynı an + 15.500 KK (aynı an), aynı pakete bağlı
//   3 · paketin anlaşılan tutarı 14.000 → 15.500 (amend). Tarihlere dokunulmaz.

const STUDIO = 'retro'
const RUN = 'zuleyha-tanis-7-aylik-2026-11-20'
const ODEME = 'pay_01M7WPXNZW14R3ZKEMV54R6S5F'
const FARK_SATIS = 'sal_01M7WPXNTR0467C379VBFX83EW'
const PAKET_SATIS = 'sal_01M7WEZRABTKJ4AB5MRYMVM8EA'
const PAKET = 'ent_01M7WEZRACB01JC0K7YBM9JQRA'
const TUTAR = 1_550_000
const SEBEP = '7 aylık (resepsiyon bitişi uzattı), tek satış 15.500 ₺; "Kart taksit farkı" ayrımı yanlıştı (owner, 20.11.2026).'

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply')
  initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID ?? 'studio-yonetim-prod' })
  const db = getFirestore()
  const ctx = { studioId: STUDIO, actor: { type: 'platform_admin', id: `migration:${RUN}` }, branchIds: ['mutlukent'], correlationId: RUN, source: 'migration', role: 'platform_admin' } as unknown as TenantContext
  const deps: FinanceDeps = { repo: new FirestoreFinanceRepository(db), clock: systemClock, source: 'migration' }
  const entRepo = new FirestoreEntitlementRepository(db)
  const dur = (m: string): never => { console.error(`DUR: ${m}`); process.exit(1) }

  const pay = await deps.repo.getPayment(ctx, ODEME)
  const fark = await deps.repo.getSale(ctx, FARK_SATIS)
  const paket = await deps.repo.getSale(ctx, PAKET_SATIS)
  const ent = await entRepo.getEntitlement(ctx, PAKET as EntitlementId)
  if (!pay || pay.voided || pay.amount.amount !== TUTAR) return dur('ödeme beklenen durumda değil')
  if (!fark || fark.status === 'cancelled' || fark.total.amount !== 150_000) return dur('fark satışı beklenen durumda değil')
  if (!paket || paket.status === 'cancelled' || paket.total.amount !== 1_400_000) return dur('paket satışı beklenen durumda değil')
  if (!ent || ent.status !== 'active' || ent.priceAgreed.amount !== 1_400_000) return dur('paket beklenen durumda değil')
  const line = paket.lines[0]!
  console.log(apply ? '── UYGULANIYOR ──' : '── KURU ÇALIŞMA ──')
  console.log(`iptal  : ${ODEME} 15.500 KK · ${FARK_SATIS} "Kart taksit farkı" · ${PAKET_SATIS} 14.000`)
  console.log(`yeni   : "${line.description}" 15.500 ₺ + 15.500 KK, paket ${PAKET} anlaşılan 14.000→15.500`)
  if (!apply) return console.log('\nkuru çalışma — hiçbir şey yazılmadı')

  for (const [ad, r] of [
    ['ödeme', await voidPayment(deps, ctx, { paymentId: ODEME, reason: SEBEP })],
    ['fark satışı', await cancelSale(deps, ctx, { saleId: FARK_SATIS, reason: SEBEP })],
    ['paket satışı', await cancelSale(deps, ctx, { saleId: PAKET_SATIS, reason: SEBEP })],
  ] as const) if (!r.ok) return dur(`${ad}: ${JSON.stringify(r.error)}`)
  const op = newOperationId().slice(4)
  const s = await sell(deps, ctx, {
    saleId: `sal_${op}`, memberId: paket.memberId as MemberId, branchId: paket.branchId as BranchId, soldAt: paket.soldAt,
    lines: [{ ...line, unitPrice: money(TUTAR), entitlementId: PAKET as never }],
    discounts: [], discountCeilingPercent: null,
    payment: { paymentId: `pay_${op}`, allocationId: `alc_${op}`, amount: money(TUTAR), method: 'credit_card', receivedAt: pay.receivedAt, drawerId: pay.drawerId, giftCardCode: null, note: null, allowNoDrawer: pay.drawerId == null },
  })
  if (!s.ok) return dur(`yeni satış: ${JSON.stringify(s.error)}`)
  const a = await amendEntitlement({ repo: entRepo, clock: systemClock }, ctx, { entitlementId: PAKET as EntitlementId, patch: { priceAgreed: money(TUTAR) }, reason: SEBEP })
  if (!a.ok) return dur(`paket tutarı: ${JSON.stringify(a.error)}`)
  console.log(`✅ tek satış 15.500 ₺: ${s.value.saleId}`)
  process.exit(0)
}
void main().catch((e) => { console.error(e); process.exit(1) })
