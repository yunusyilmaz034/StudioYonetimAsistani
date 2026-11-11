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

// MELİKE BAYINDIR — FITNESS 1 AYLIKTAN 3 AYLIĞA TAMAMLAMA (owner, 2026-11-11: "paketin başlangıç tarihi aynı
// kalacak şekilde 3 aylığa çevir dün de 4500 tl farkını ödedi … nakit dün aldık merkez kasa onayla uygula").
//
//   pnpm tsx tools/migration/melike-bayindir-tamamlama-2026-11-11.ts            (kuru çalışma)
//   pnpm tsx tools/migration/melike-bayindir-tamamlama-2026-11-11.ts --apply
//
// 1 · PAKET (break-glass amend, `entitlement.amended` olayı, sebepli): ürün kaydı "Fitness - 3 Aylık",
//     başlangıç AYNI (31.10.2026), bitiş başlangıç + 90 gün, anlaşılan tutar 4.000 + 4.500 = 8.500 ₺
//     (3 aylığın nakit fiyatı; Sinem Aktay tamamlamasındaki emsal). Panelin "Düzenle"si ürünü değiştiremez —
//     bilerek (decideAmend: "deliberately NOT exposed by the panel").
//     Dondurma hakkı (3 aylıkta 7 gün) MEVCUT pakete sonradan verilemiyor — bu betik onu YAZMAZ; gerekirse
//     dondurma patron onayıyla (override) yapılır.
// 2 · PARA (OR-95, serbest kalem): "Fitness 1 aylıktan 3 aylığa tamamlama farkı" 4.500 ₺ satış + aynı tutarda
//     NAKİT tahsilat, Merkez Kasa, DÜNÜN tarihiyle (10.11.2026) — kasa o günü görür.

const STUDIO = 'retro'
const RUN = 'melike-bayindir-tamamlama-2026-11-11'
const UYE = 'mem_01M5CP76B7YDDCFNA0508MDC7P'
const PAKET = 'ent_01M66MSP9MTEDK1TW0KPYF3PAR'
const ESKI_URUN = 'prd_01KYQADEWKSWXTZM2FHBDCMW3C' // Fitness - 1 Aylık
const YENI_URUN = 'prd_01KXJD2CW08CNP08KJRSW34DRR' // Fitness - 3 Aylık
const KASA = 'drw_01KXGHV45ZJ91XCHHSNGN7A00H' // Merkez Kasa
const FARK = 450_000
const TOPLAM = 850_000
const ALINDI = Date.parse('2026-11-10T12:00:00+03:00') // dün, öğle — saat bilinmiyor
const ACIKLAMA = 'Fitness 1 aylıktan 3 aylığa tamamlama farkı'
const SEBEP = '1 aylıktan 3 aylığa tamamlama — başlangıç aynı, 4.500 ₺ fark nakit alındı (owner, 11.11.2026)'
const DAY = 86_400_000

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply')
  initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID ?? 'studio-yonetim-prod' })
  const db = getFirestore()
  const ctx = {
    studioId: STUDIO,
    actor: { type: 'platform_admin', id: `migration:${RUN}` },
    branchIds: ['mutlukent'],
    correlationId: RUN,
    source: 'migration',
    role: 'platform_admin',
  } as unknown as TenantContext
  const dur = (m: string): never => {
    console.error(`DUR: ${m}`)
    process.exit(1)
  }

  const entRepo = new FirestoreEntitlementRepository(db)
  const ent = await entRepo.getEntitlement(ctx, PAKET as EntitlementId)
  if (!ent) return dur('paket yok')
  if (String(ent.memberId) !== UYE || String(ent.productSnapshot.productId) !== ESKI_URUN || ent.status !== 'active') return dur('paket beklenen durumda değil (üye/ürün/durum)')
  const p = (await db.doc(`studios/${STUDIO}/products/${YENI_URUN}`).get()).data()
  if (!p || p.name !== 'Fitness - 3 Aylık' || p.durationDays !== 90 || p.cashPriceInKurus !== TOPLAM) return dur('3 aylık ürün beklenen gibi değil')
  const validFrom = Number(ent.validFrom)
  const validUntil = validFrom + 90 * DAY
  const snapshot = {
    productId: YENI_URUN,
    name: p.name,
    category: p.category,
    grant: { kind: 'period', durationDays: 90, access: 'unlimited' },
    listPrice: money(p.priceInKurus),
    serviceIds: p.serviceIds,
    cancellationAllowanceCount: p.cancellationAllowanceCount ?? null,
    dailyReservationLimit: p.dailyReservationLimit ?? null,
    activeReservationLimit: p.activeReservationLimit ?? null,
    entryAllowance: p.entryAllowance ?? null,
  }
  const fin = new FirestoreFinanceRepository(db)
  const dup = (await db.collection(`studios/${STUDIO}/payments`).where('memberId', '==', UYE).get()).docs.filter((d) => d.get('amount.amount') === FARK && !d.get('voided'))
  if (dup.length) return dur(`üyede zaten ${FARK / 100} ₺'lik bir tahsilat var (${dup[0]!.id}) — iki kez yazmayayım.`)

  const d = (ms: number) => new Date(ms).toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul' })
  console.log(apply ? '── UYGULANIYOR ──' : '── KURU ÇALIŞMA ──')
  console.log(`paket   : ${ent.productSnapshot.name} → ${snapshot.name}`)
  console.log(`tarih   : ${d(validFrom)} → ${d(Number(ent.validUntil))}  ⇒  ${d(validFrom)} → ${d(validUntil)}`)
  console.log(`tutar   : ${ent.priceAgreed.amount / 100} → ${TOPLAM / 100} ₺`)
  console.log(`para    : "${ACIKLAMA}" ${FARK / 100} ₺ satış + nakit tahsilat, Merkez Kasa, ${new Date(ALINDI).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' })}`)
  if (!apply) return console.log('\nkuru çalışma — hiçbir şey yazılmadı')

  const a = await amendEntitlement({ repo: entRepo, clock: systemClock }, ctx, {
    entitlementId: PAKET as EntitlementId,
    patch: { productSnapshot: snapshot as never, validUntil: instant(validUntil), priceAgreed: money(TOPLAM) },
    reason: SEBEP,
  })
  if (!a.ok) return dur(`paket: ${JSON.stringify(a.error)}`)
  console.log('✅ paket 3 aylığa çevrildi (entitlement.amended)')

  const deps: FinanceDeps = { repo: fin, clock: systemClock, source: 'migration' }
  const opId = newOperationId() // the panel's own id scheme (sellAction)
  const s = await sell(deps, ctx, {
    saleId: `sal_${opId.slice(4)}`,
    memberId: UYE as MemberId,
    branchId: 'mutlukent' as BranchId,
    lines: [{ productId: null as never, description: ACIKLAMA, quantity: 1, unitPrice: money(FARK), entitlementId: null, giftCardId: null }],
    discounts: [],
    discountCeilingPercent: null,
    payment: {
      paymentId: `pay_${opId.slice(4)}`,
      allocationId: `alc_${opId.slice(4)}`,
      amount: money(FARK),
      method: 'cash',
      receivedAt: instant(ALINDI),
      drawerId: KASA,
      giftCardCode: null,
      note: ACIKLAMA,
    },
  })
  if (!s.ok) return dur(`satış: ${JSON.stringify(s.error)}`)
  console.log(`✅ satış + nakit tahsilat yazıldı: ${s.value.saleId}`)
  process.exit(0)
}
void main().catch((e) => {
  console.error(e)
  process.exit(1)
})
