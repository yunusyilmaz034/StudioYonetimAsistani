import {
  FirestoreEntitlementRepository,
  FirestoreFinanceRepository,
  amendEntitlement,
  collect,
  discountSale,
  instant,
  money,
  systemClock,
  voidPayment,
  type EntitlementId,
  type MemberId,
  type StudioId,
  type TenantContext,
} from '@studio/core'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

// THE WRONG PRODUCT WAS SOLD — a break-glass correction, run by hand, once.
//
//   pnpm tsx tools/migration/fix-wrong-product-2026-08.ts            (dry run — writes NOTHING)
//   pnpm tsx tools/migration/fix-wrong-product-2026-08.ts --apply
//
// ── WHAT HAPPENED ───────────────────────────────────────────────────────────────────────────
//
// On 2026-08-03 two members bought a THREE-month fitness package. Reception picked "Fitness - 6
// Aylık" from the list, at 13.000 ₺. What was actually agreed, per the owner: 9.000 ₺ list, 1.000 ₺
// discount, 8.000 ₺ taken in cash. No debt, no credit, on either.
//
// The records disagreed with that in two different ways, and only reading them showed it:
//
//   · GÜLCAN — a first 13.000 ₺ cash payment was already VOIDED by reception, and a real 8.000 ₺ one
//     stands. Her money is right; only the product, the end date and the price are wrong.
//   · HAVA — her 13.000 ₺ cash payment is NOT voided and is fully allocated. The books say she paid
//     13.000 ₺; the owner says she paid 8.000 ₺. So 5.000 ₺ sits in the recorded till that was never
//     taken, and correcting that is the whole point of touching her payment at all.
//
// ── WHAT THIS DOES NOT DO ───────────────────────────────────────────────────────────────────
//
// It does not cancel the sales and re-sell. That would tear apart a payment record that is correct
// (Gülcan's) to fix a field that is not, and it would leave the orphan open sale OR-37 exists about.
// Every write here is an append-only correction on the records that already exist.
//
// The sale's GROSS stays 13.000 ₺ — that is what was rung up, and rewriting it would be the kind of
// silent edit the ledger is built to prevent. The two discounts below carry the truth instead: one
// says the product was wrong, one is the discount that was actually agreed. Anyone reading the sale
// later sees both facts, in that order.

const STUDIO = 'retro'
const RUN_ID = 'mig_2026_08_17_wrong_product'
const DAY_MS = (iso: string) => {
  const ms = Date.parse(`${iso}T00:00:00+03:00`)
  if (Number.isNaN(ms)) throw new Error(`bad date: ${iso}`)
  return ms
}

/** The product they actually bought. Read from the catalogue, never typed in here (AD-41). */
const RIGHT_PRODUCT_ID = 'prd_01KXJD2CW08CNP08KJRSW34DRR' // Fitness - 3 Aylık
const NEW_VALID_UNTIL = '2026-11-01' // 03.08.2026 + 90 gün
const RIGHT_PRICE_KURUS = 900_000 // 9.000 ₺
const CORRECTION_DISCOUNT = 400_000 // 13.000 → 9.000: the mis-entered product
const AGREED_DISCOUNT = 100_000 // 9.000 → 8.000: what was actually agreed
const REAL_CASH_KURUS = 800_000 // 8.000 ₺

const REASON = 'Yanlış ürün girilmişti: Fitness 6 Aylık yerine 3 Aylık satıldı (owner, 17.08.2026)'

interface Target {
  readonly who: string
  readonly memberId: string
  readonly entitlementId: string
  readonly saleId: string
  /** Present only where the recorded payment is wrong and must be replaced. */
  readonly wrongPaymentId?: string
}

const TARGETS: readonly Target[] = [
  {
    who: 'Gülcan Ayvaz',
    memberId: 'mem_01KZ3E2WTC54GTYB8WJ5ENFDRQ',
    entitlementId: 'ent_01KZ3E35PYC01HTRPQW030Z1MH',
    saleId: 'sal_01KZ3E35PDZH6CP3QP7Y3ZJSX4',
    // no wrongPaymentId: her 8.000 ₺ is real and her bad payment was already voided at the desk.
  },
  {
    who: 'Hava Kolu',
    memberId: 'mem_01KZ3DV0GWQ5PDZ6T2MHQZT9S2',
    entitlementId: 'ent_01KZ3DXZDE0HKCGJH4K5X9S60X',
    saleId: 'sal_01KZ3DXZCGJBGN2VPT3V84Z8QR',
    wrongPaymentId: 'pay_01KZ3DXZCGJBGN2VPT3V84Z8QR', // 13.000 ₺ recorded, 8.000 ₺ taken
  },
]

const tl = (kurus: number) => `${(kurus / 100).toLocaleString('tr-TR')} ₺`

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply')
  initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID ?? 'studio-yonetim-prod' })
  const db = getFirestore()

  // A `migration` principal, never a receptionist's login (#5). She did not make this change, and
  // the log must not say she did.
  const ctx: TenantContext = {
    studioId: STUDIO as StudioId,
    branchIds: ['mutlukent'] as unknown as TenantContext['branchIds'],
    role: 'owner',
    actor: { type: 'migration', id: RUN_ID as never },
  }
  const ents = { repo: new FirestoreEntitlementRepository(db), clock: systemClock }
  const fin = { repo: new FirestoreFinanceRepository(db), clock: systemClock }

  const product = await db.doc(`studios/${STUDIO}/products/${RIGHT_PRODUCT_ID}`).get()
  if (!product.exists) throw new Error('Fitness - 3 Aylık ürünü bulunamadı')
  const p = product.data() as Record<string, unknown>
  console.log(`Doğru ürün: ${String(p.name)} · ${String(p.durationDays)} gün · ${tl(Number(p.priceInKurus))}\n`)

  console.log(apply ? '── UYGULANIYOR ──\n' : '── KURU ÇALIŞMA (hiçbir şey yazılmaz) ──\n')

  for (const t of TARGETS) {
    const before = await db.doc(`studios/${STUDIO}/entitlements/${t.entitlementId}`).get()
    if (!before.exists) {
      console.log(`✗ ${t.who}: paket bulunamadı`)
      continue
    }
    const snap = before.get('productSnapshot') as Record<string, unknown>
    console.log(`━━ ${t.who}`)
    console.log(`   ürün   : ${String(snap.name)}  →  ${String(p.name)}`)
    console.log(`   bitiş  : ${new Date((before.get('validUntil') as { toMillis(): number }).toMillis() + 180 * 60_000).toISOString().slice(0, 10)}  →  ${NEW_VALID_UNTIL}`)
    console.log(`   tutar  : ${tl((before.get('priceAgreed') as { amount: number }).amount)}  →  ${tl(RIGHT_PRICE_KURUS)}`)
    console.log(`   indirim: ${tl(CORRECTION_DISCOUNT)} (ürün düzeltmesi) + ${tl(AGREED_DISCOUNT)} (anlaşılan) → net ${tl(REAL_CASH_KURUS)}`)
    if (t.wrongPaymentId) console.log(`   ödeme  : 13.000 ₺ İPTAL → ${tl(REAL_CASH_KURUS)} nakit yeniden kaydedilir (kasa −5.000 ₺)`)
    else console.log(`   ödeme  : dokunulmuyor — ${tl(REAL_CASH_KURUS)} zaten doğru`)

    if (!apply) {
      console.log('')
      continue
    }

    // 1. The package itself: what was sold, for how long, at what price.
    const amended = await amendEntitlement(ents, ctx, {
      entitlementId: t.entitlementId as EntitlementId,
      patch: {
        productSnapshot: {
          ...(snap as Record<string, unknown>),
          productId: p.productId ?? RIGHT_PRODUCT_ID,
          name: String(p.name),
          grant: { kind: 'period', durationDays: Number(p.durationDays), access: 'unlimited' },
          listPrice: money(Number(p.priceInKurus)),
        } as never,
        validUntil: instant(DAY_MS(NEW_VALID_UNTIL)),
        priceAgreed: money(RIGHT_PRICE_KURUS),
      },
      reason: REASON,
    })
    if (!amended.ok) {
      console.log(`   ✗ paket düzeltilemedi: ${JSON.stringify(amended.error)}\n`)
      continue
    }

    // 2. The money, only where it is wrong. Void first: the sale must be un-paid before the real
    //    payment lands on it, or the second one has nothing to settle.
    if (t.wrongPaymentId) {
      const voided = await voidPayment(fin, ctx, {
        paymentId: t.wrongPaymentId,
        reason: `${REASON} — 13.000 ₺ kaydedilmişti, tahsil edilen 8.000 ₺`,
      })
      if (!voided.ok) {
        console.log(`   ✗ ödeme iptal edilemedi: ${JSON.stringify(voided.error)}\n`)
        continue
      }
      const took = await collect(fin, ctx, {
        paymentId: `pay_${RUN_ID}_${t.memberId.slice(-6)}`,
        memberId: t.memberId as MemberId,
        branchId: 'mutlukent' as never,
        amount: money(REAL_CASH_KURUS),
        method: 'cash',
        receivedAt: instant(DAY_MS('2026-08-03')),
        drawerId: 'drw_01KXGHV45ZJ91XCHHSNGN7A00H',
        giftCardCode: null,
        note: 'Düzeltme — gerçekte tahsil edilen tutar',
        // OR-37: this payment knows its sale. It must not wander to another open one.
        allocateTo: [{ saleId: t.saleId, amount: money(REAL_CASH_KURUS), allocationId: `alc_${RUN_ID}_${t.memberId.slice(-6)}` }],
      })
      if (!took.ok) {
        console.log(`   ✗ tahsilat kaydedilemedi: ${JSON.stringify(took.error)}\n`)
        continue
      }
    }

    // 3. The sale, brought to what was actually owed. Two discounts, because there are two facts.
    for (const [amount, note] of [
      [CORRECTION_DISCOUNT, 'Yanlış ürün düzeltmesi: 6 Aylık (13.000 ₺) yerine 3 Aylık (9.000 ₺)'],
      [AGREED_DISCOUNT, 'Anlaşılan indirim: 9.000 ₺ → 8.000 ₺'],
    ] as const) {
      const disc = await discountSale(fin, ctx, {
        saleId: t.saleId,
        discount: {
          reason: 'manual',
          amount: money(amount),
          note,
          couponCode: null,
          referredByMemberId: null,
          grantedBy: ctx.actor,
        },
      })
      if (!disc.ok) console.log(`   ✗ indirim yazılamadı (${tl(amount)}): ${JSON.stringify(disc.error)}`)
    }

    const after = await db.doc(`studios/${STUDIO}/sales/${t.saleId}`).get()
    console.log(
      `   ✓ satış: toplam ${tl((after.get('total') as { amount: number }).amount)} · ödenen ${tl((after.get('paid') as { amount: number }).amount)} · ${after.get('status')}\n`,
    )
  }

  console.log(apply ? 'Bitti.' : '\nUygulamak için --apply')
  process.exit(0)
}

void main()
