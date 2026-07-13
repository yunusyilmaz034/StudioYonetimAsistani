import {
  cancelSale,
  FirestoreEntitlementRepository,
  FirestoreFinanceRepository,
  instant,
  money,
  sell,
  type Clock,
  type Entitlement,
  type FinanceDeps,
  type Instant,
  type MigrationRunId,
  type StudioId,
  type TenantContext,
} from '@studio/core'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

import { writeReport } from './validate'

// DEBT-021 — the legacy money migration. **This is the one that moves money, and it runs once.**
//
//   pnpm migrate:legacy-finance -- --studio=<sid> --branch=<bid>            ← dry-run
//   pnpm migrate:legacy-finance -- --studio=<sid> --branch=<bid> --apply
//
// ── The problem it closes ────────────────────────────────────────────────────────────────────
// Until v1.24 a sale was a FIELD on an entitlement (`priceAgreed`, `paidTotal`, `manualPayment`).
// From v1.24 money has its own ledger (Sale → Payment → Allocation). Two sources of truth for the
// same money is intolerable — a finance module that disagrees with itself is worse than none — so
// the owner chose to MIGRATE once, with reconciliation, rather than carry `if (legacy)` through
// every query and report forever (Doc 26 §5, decision (a)).
//
// ── Why it calls the REAL use-case instead of writing events ────────────────────────────────
// It would be easy — and wrong — to hand-write `sale.created` and `payment.received` into the log.
// The ledger's arithmetic (the allocation, the balance, the over-payment rule, I-32…I-35) lives in
// `sell()`. A migration that bypasses the domain to save an afternoon produces a ledger that is
// subtly, permanently, unverifiably wrong. So this runs `sell()` — the same function reception
// runs — with a **fixed clock** pinned to the original purchase instant, so `soldAt` is the day the
// package was actually bought and not the day we happened to migrate it.
//
// ── Idempotency ──────────────────────────────────────────────────────────────────────────────
// The sale id is DERIVED from the entitlement id. Running this twice finds the sale already there
// and skips it. A migration that double-charges every member on its second run is a migration that
// will, once, be run twice.

/** The clock that makes a historical sale historical. */
const fixedClock = (at: Instant): Clock => ({ now: () => at })

/**
 * When was this package cancelled? Read from the LOG, never guessed.
 *
 * The entitlement document does not carry a `cancelledAt`; the event does. This is a script (not a
 * projector), so reading the log is legitimate — and it is the only truthful source for a date that
 * belongs to a month's revenue figure.
 */
async function cancellationInstant(
  db: FirebaseFirestore.Firestore,
  ctx: TenantContext,
  entitlementId: string,
): Promise<Instant | null> {
  const snap = await db
    .collection(`studios/${ctx.studioId}/events`)
    .where('related.entitlementId', '==', entitlementId)
    .where('type', '==', 'entitlement.cancelled')
    .limit(1)
    .get()
  const at = snap.docs[0]?.data()?.occurredAt as { toMillis?: () => number } | undefined
  return at?.toMillis ? instant(at.toMillis()) : null
}

/** Deterministic, so a re-run is a no-op rather than a second sale. */
const saleIdFor = (e: Entitlement) => `sal_mig_${e.id}`
const paymentIdFor = (e: Entitlement) => `pay_mig_${e.id}`
const allocationIdFor = (e: Entitlement) => `alc_mig_${e.id}`

interface Row {
  readonly entitlementId: string
  readonly memberId: string
  readonly soldKurus: number
  readonly collectedKurus: number
  readonly outcome: 'migrated' | 'skipped_zero' | 'skipped_exists' | 'failed'
  readonly detail?: string
}

function renderReport(runId: MigrationRunId, applied: boolean, rows: readonly Row[]): string {
  const migrated = rows.filter((r) => r.outcome === 'migrated')
  const failed = rows.filter((r) => r.outcome === 'failed')
  const skippedExists = rows.filter((r) => r.outcome === 'skipped_exists')
  const skippedZero = rows.filter((r) => r.outcome === 'skipped_zero')

  const sum = (rs: readonly Row[], f: (r: Row) => number) => rs.reduce((n, r) => n + f(r), 0)
  const tl = (kurus: number) => (kurus / 100).toLocaleString('tr-TR', { minimumFractionDigits: 2 })

  const lines: string[] = []
  lines.push(`# Legacy finans migrasyonu — \`${runId}\` (DEBT-021)`)
  lines.push('')
  lines.push(applied ? '**MOD: APPLY — ledger’a yazıldı.**' : '**MOD: DRY-RUN — hiçbir şey yazılmadı.**')
  lines.push('')
  lines.push('## Özet')
  lines.push('')
  lines.push('| | Adet | Tutar (₺) |')
  lines.push('|---|---|---|')
  lines.push(`| Migre edilen satış | ${migrated.length} | ${tl(sum(migrated, (r) => r.soldKurus))} |`)
  lines.push(`| Migre edilen tahsilat | ${migrated.filter((r) => r.collectedKurus > 0).length} | ${tl(sum(migrated, (r) => r.collectedKurus))} |`)
  lines.push(`| Zaten migre edilmiş (atlandı) | ${skippedExists.length} | — |`)
  lines.push(`| Bedelsiz paket (atlandı) | ${skippedZero.length} | — |`)
  lines.push(`| **Başarısız** | **${failed.length}** | — |`)
  lines.push('')

  if (failed.length) {
    lines.push('## Başarısız')
    lines.push('')
    lines.push('| Paket | Üye | Hata |')
    lines.push('|---|---|---|')
    for (const r of failed) lines.push(`| ${r.entitlementId} | ${r.memberId} | ${r.detail} |`)
    lines.push('')
    lines.push('> **Kısmî bir migrasyon kabul edilebilir değildir.** Başarısız satır varsa sebebi ' +
      'bulunup düzeltilmeli ve script yeniden çalıştırılmalıdır — idempotenttir, başarılı olanları ' +
      'tekrar yazmaz.')
  }

  lines.push('')
  lines.push('> Entitlement’ın eski para alanları (`priceAgreed`, `paidTotal`, `manualPayment`) ' +
    '**SİLİNMEDİ.** Expand → migrate → **contract**, ve contract çok sonra, ayrı bir kararla ' +
    '(Doc 6 §10). Bir migrasyonun aynı gün hem yazıp hem sildiği veri, doğrulanamayan veridir.')
  return `${lines.join('\n')}\n`
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const flag = (n: string) => argv.find((a) => a.startsWith(`--${n}=`))?.split('=')[1]
  const studioId = flag('studio') as StudioId | undefined
  const branchId = flag('branch')
  const apply = argv.includes('--apply')

  if (!studioId || !branchId) {
    console.error('Kullanım: pnpm migrate:legacy-finance -- --studio=<sid> --branch=<bid> [--apply]')
    process.exit(2)
  }

  const runId = `legacy_finance_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}` as MigrationRunId
  initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID })
  const db = getFirestore()

  const ctx: TenantContext = {
    studioId,
    branchIds: [branchId as never],
    role: 'owner',
    actor: { type: 'migration', id: runId },
  }

  const entRepo = new FirestoreEntitlementRepository(db)
  const finRepo = new FirestoreFinanceRepository(db)
  const entitlements = await entRepo.listAll(ctx)

  const rows: Row[] = []

  for (const e of entitlements) {
    const soldKurus = e.priceAgreed.amount
    const collectedKurus = e.manualPayment?.collectedAmount.amount ?? 0

    if (soldKurus === 0 && collectedKurus === 0) {
      rows.push({ entitlementId: e.id, memberId: e.memberId, soldKurus, collectedKurus, outcome: 'skipped_zero' })
      continue
    }

    const saleId = saleIdFor(e)
    if (await finRepo.getSale(ctx, saleId)) {
      // Already migrated. The id is derived, so this is what a second run looks like — and a second
      // run must never mean a second sale.
      rows.push({ entitlementId: e.id, memberId: e.memberId, soldKurus, collectedKurus, outcome: 'skipped_exists' })
      continue
    }

    if (!apply) {
      rows.push({ entitlementId: e.id, memberId: e.memberId, soldKurus, collectedKurus, outcome: 'migrated' })
      continue
    }

    // The clock is pinned to the ORIGINAL purchase. `soldAt` is when she bought it, not when we
    // migrated it — otherwise every historical sale lands on one day and every revenue chart lies.
    const deps: FinanceDeps = {
      repo: finRepo,
      clock: fixedClock(e.purchasedAt),
      source: 'migration',
    }

    const res = await sell(deps, ctx, {
      saleId,
      memberId: e.memberId,
      branchId: branchId as never,
      lines: [
        {
          productId: e.productId,
          description: e.productSnapshot.name,
          quantity: 1,
          unitPrice: money(soldKurus),
          entitlementId: e.id, // the join back to the package this money bought
          giftCardId: null,
        },
      ],
      // NO discount is invented. The gap between the product's list price and `priceAgreed` was a
      // discount SOMEBODY gave, for a reason nobody wrote down — and DEBT-002 says so honestly.
      // Manufacturing a `manual` discount here would fabricate a record of a decision that was
      // never made, in a log that is permanent.
      discounts: [],
      discountCeilingPercent: null,
      payment:
        collectedKurus > 0 && e.manualPayment
          ? {
              paymentId: paymentIdFor(e),
              allocationId: allocationIdFor(e),
              amount: money(collectedKurus),
              method: e.manualPayment.method,
              receivedAt: e.manualPayment.recordedAt, // when the money actually arrived
              drawerId: null, // there was no drawer before v1.24. Inventing one would be a lie.
              giftCardCode: null,
              note: e.manualPayment.note,
            }
          : null,
    })

    if (res.ok) {
      // A CANCELLED package's sale was reversed, and the ledger must say so — otherwise the migration
      // reports revenue the studio gave back. The cancellation INSTANT is read from the log (the
      // `entitlement.cancelled` event), never guessed: netting it against the purchase date would
      // move money out of a month it was actually in, and rewriting a past day's total is how a
      // dashboard starts disagreeing with a report somebody already printed.
      if (e.status === 'cancelled') {
        const cancelledAt = await cancellationInstant(db, ctx, e.id)
        const undo = await cancelSale(
          { repo: finRepo, clock: fixedClock(cancelledAt ?? e.purchasedAt), source: 'migration' },
          ctx,
          { saleId, reason: 'Paket iptal edilmişti (v1.14 aktarımı)' },
        )
        if (!undo.ok) {
          rows.push({
            entitlementId: e.id,
            memberId: e.memberId,
            soldKurus,
            collectedKurus,
            outcome: 'failed',
            detail: `sale created but cancel failed: ${undo.error.code}`,
          })
          continue
        }
      }
      rows.push({ entitlementId: e.id, memberId: e.memberId, soldKurus, collectedKurus, outcome: 'migrated' })
    } else {
      rows.push({
        entitlementId: e.id,
        memberId: e.memberId,
        soldKurus,
        collectedKurus,
        outcome: 'failed',
        detail: res.error.code,
      })
    }
  }

  const path = writeReport('legacy-finance.md', renderReport(runId, apply, rows))
  const failed = rows.filter((r) => r.outcome === 'failed').length
  console.log(`${apply ? 'APPLY' : 'DRY-RUN'} · ${rows.length} paket incelendi · başarısız ${failed}`)
  console.log(`Rapor: ${path}`)
  if (failed) process.exit(1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

export { fixedClock, saleIdFor }
