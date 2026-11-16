import {
  FirestoreEntitlementRepository,
  FirestoreFinanceRepository,
  amendEntitlement,
  instant,
  money,
  newOperationId,
  sell,
  systemClock,
  type BranchId,
  type EntitlementId,
  type FinanceDeps,
  type MemberId,
  type TenantContext,
} from '@studio/core'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

// AYLİN ŞANLI + AYNUR KAYA — FITNESS 1 AYLIKTAN 3 AYLIĞA TAMAMLAMA (owner/resepsiyon, 2026-11-16: "1 aylık paketini 3 aya
// çevirdi ve 4000 TL geçen hafta ödedi bugün de 4500 kalan ödeme yapıldı, iki ödeme de nakit").
//
//   pnpm tsx tools/migration/aylin-aynur-tamamlama-2026-11-16.ts            (kuru çalışma)
//   pnpm tsx tools/migration/aylin-aynur-tamamlama-2026-11-16.ts --apply
//
// Melike Bayındır (11.11) emsali, iki üye için: 1 · paket break-glass amend (ürün "Fitness - 3 Aylık", başlangıç AYNI,
// bitiş +90 gün, anlaşılan 8.500 ₺) · 2 · "Fitness 1 aylıktan 3 aylığa tamamlama farkı" 4.500 ₺ satış + nakit tahsilat,
// Merkez Kasa, BUGÜN (satış ve tahsilat aynı gün — Melike'deki tarih kayması burada yok). 4.000 ₺ zaten 11.11'de alınmış.

const STUDIO = 'retro'
const RUN = 'aylin-aynur-tamamlama-2026-11-16'
const UYELER = [
  { ad: 'AYLİN ŞANLI', uye: 'mem_01KZVA7CV9SF3ECMHN91TNS2BC', paket: 'ent_01M70PKCQXGP40605FPRBWDVYN' },
  { ad: 'AYNUR KAYA', uye: 'mem_01KZP5XM307KN2M4C4Y8P2F8YP', paket: 'ent_01M70PHTVFAYTG6D06NK2SS3GA' },
] as const
const ESKI_URUN = 'prd_01KYQADEWKSWXTZM2FHBDCMW3C' // Fitness - 1 Aylık
const YENI_URUN = 'prd_01KXJD2CW08CNP08KJRSW34DRR' // Fitness - 3 Aylık
const KASA = 'drw_01KXGHV45ZJ91XCHHSNGN7A00H' // Merkez Kasa
const FARK = 450_000
const TOPLAM = 850_000
const ACIKLAMA = 'Fitness 1 aylıktan 3 aylığa tamamlama farkı'
const SEBEP = '1 aylıktan 3 aylığa tamamlama — başlangıç aynı, 4.000 ₺ 11.11 + 4.500 ₺ 16.11 nakit (resepsiyon/owner, 16.11.2026)'
const DAY = 86_400_000

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply')
  initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID ?? 'studio-yonetim-prod' })
  const db = getFirestore()
  const ctx = {
    studioId: STUDIO, actor: { type: 'platform_admin', id: `migration:${RUN}` }, branchIds: ['mutlukent'], correlationId: RUN, source: 'migration', role: 'platform_admin',
  } as unknown as TenantContext
  const dur = (m: string): never => { console.error(`DUR: ${m}`); process.exit(1) }
  const entRepo = new FirestoreEntitlementRepository(db)
  const deps: FinanceDeps = { repo: new FirestoreFinanceRepository(db), clock: systemClock, source: 'migration' }
  const p = (await db.doc(`studios/${STUDIO}/products/${YENI_URUN}`).get()).data()
  if (!p || p.name !== 'Fitness - 3 Aylık' || p.durationDays !== 90 || p.cashPriceInKurus !== TOPLAM) return dur('3 aylık ürün beklenen gibi değil')
  const snapshot = {
    productId: YENI_URUN, name: p.name, category: p.category,
    grant: { kind: 'period', durationDays: 90, access: 'unlimited' },
    listPrice: money(p.priceInKurus), serviceIds: p.serviceIds,
    cancellationAllowanceCount: p.cancellationAllowanceCount ?? null,
    dailyReservationLimit: p.dailyReservationLimit ?? null,
    activeReservationLimit: p.activeReservationLimit ?? null,
    entryAllowance: p.entryAllowance ?? null,
  }
  const d = (ms: number) => new Date(ms).toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul' })

  // Check both before writing either.
  const plan = []
  for (const u of UYELER) {
    const ent = await entRepo.getEntitlement(ctx, u.paket as EntitlementId)
    if (!ent || String(ent.memberId) !== u.uye || String(ent.productSnapshot.productId) !== ESKI_URUN || ent.status !== 'active' || ent.priceAgreed.amount !== 400_000)
      return dur(`${u.ad}: paket beklenen durumda değil`)
    const dup = (await db.collection(`studios/${STUDIO}/payments`).where('memberId', '==', u.uye).get()).docs.filter((x) => x.get('amount.amount') === FARK && !x.get('voided'))
    if (dup.length) return dur(`${u.ad}: zaten ${FARK / 100} ₺'lik tahsilat var (${dup[0]!.id})`)
    plan.push({ u, ent, validFrom: Number(ent.validFrom) })
  }
  console.log(apply ? '── UYGULANIYOR ──' : '── KURU ÇALIŞMA ──')
  for (const { u, ent, validFrom } of plan)
    console.log(`${u.ad}: ${ent.productSnapshot.name} ${d(validFrom)}→${d(Number(ent.validUntil))}  ⇒  Fitness - 3 Aylık ${d(validFrom)}→${d(validFrom + 90 * DAY)}, 4.000→8.500 ₺; +4.500 ₺ nakit bugün`)
  if (!apply) return console.log('\nkuru çalışma — hiçbir şey yazılmadı')

  for (const { u, validFrom } of plan) {
    const a = await amendEntitlement({ repo: entRepo, clock: systemClock }, ctx, {
      entitlementId: u.paket as EntitlementId,
      patch: { productSnapshot: snapshot as never, validUntil: instant(validFrom + 90 * DAY), priceAgreed: money(TOPLAM) },
      reason: SEBEP,
    })
    if (!a.ok) return dur(`${u.ad} paket: ${JSON.stringify(a.error)}`)
    const op = newOperationId().slice(4)
    const s = await sell(deps, ctx, {
      saleId: `sal_${op}`, memberId: u.uye as MemberId, branchId: 'mutlukent' as BranchId,
      lines: [{ productId: null as never, description: ACIKLAMA, quantity: 1, unitPrice: money(FARK), entitlementId: null, giftCardId: null }],
      discounts: [], discountCeilingPercent: null,
      payment: { paymentId: `pay_${op}`, allocationId: `alc_${op}`, amount: money(FARK), method: 'cash', receivedAt: instant(systemClock.now()), drawerId: KASA, giftCardCode: null, note: ACIKLAMA },
    })
    if (!s.ok) return dur(`${u.ad} satış: ${JSON.stringify(s.error)}`)
    console.log(`✅ ${u.ad}: 3 aylık + 4.500 ₺ nakit (${s.value.saleId})`)
  }
  process.exit(0)
}
void main().catch((e) => { console.error(e); process.exit(1) })
