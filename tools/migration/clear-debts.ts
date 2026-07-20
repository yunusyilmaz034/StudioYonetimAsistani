import {
  collect,
  FirestoreEntitlementRepository,
  FirestoreFinanceRepository,
  moneyByEntitlement,
  money,
  systemClock,
  type BranchId,
  type Entitlement,
  type FinanceDeps,
  type MemberId,
  type MigrationRunId,
  type StudioId,
  type TenantContext,
} from '@studio/core'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

// ── CLEAR OPEN BALANCES ON ACTIVE PACKAGES (owner, 2026-07-20) ───────────────────────────────
//
// While migrating old members through the panel, packages were entered with the collected amount
// left at zero (a bug now fixed), so every migrated member appears to owe the full price. These
// members ALREADY PAID in the old system. This records that payment — truthfully, through the domain,
// as the `migration` actor (so cash needs no kasa, drawerId null, #5) — and the debt goes to zero.
//
//   pnpm migrate:clear-debts -- --studio=<sid> --branch=<bid>            ← DRY-RUN (writes nothing)
//   pnpm migrate:clear-debts -- --studio=<sid> --branch=<bid> --apply    ← records the payments
//
// Idempotent by construction: a member already at zero due is skipped, so a second run is a no-op.
// It clears the debt of ACTIVE packages only; expired/cancelled ones are left as history.

const tl = (kurus: number) => `${(kurus / 100).toLocaleString('tr-TR')} TL`

async function main() {
  const argv = process.argv.slice(2)
  const flag = (name: string) => argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1]
  const studioId = flag('studio') as StudioId | undefined
  const branchId = flag('branch') as BranchId | undefined
  const apply = argv.includes('--apply')

  if (!studioId || !branchId) {
    console.error('Kullanım: pnpm migrate:clear-debts -- --studio=<sid> --branch=<bid> [--apply]')
    process.exit(1)
  }

  const runId = `clear_debts_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}` as MigrationRunId
  initializeApp(process.env.FIREBASE_PROJECT_ID ? { projectId: process.env.FIREBASE_PROJECT_ID } : {})
  const db = getFirestore()

  const ctx: TenantContext = {
    studioId,
    branchIds: [branchId],
    role: 'owner',
    actor: { type: 'migration', id: runId },
  }

  const entRepo = new FirestoreEntitlementRepository(db)
  const finRepo = new FirestoreFinanceRepository(db)
  const deps: FinanceDeps = { repo: finRepo, clock: systemClock, source: 'migration' }

  // Group ACTIVE packages by member.
  const all = await entRepo.listAll(ctx)
  const byMember = new Map<string, Entitlement[]>()
  for (const e of all) {
    if (e.status !== 'active') continue
    const list = byMember.get(e.memberId as string) ?? []
    list.push(e)
    byMember.set(e.memberId as string, list)
  }

  let grand = 0
  let cleared = 0
  const rows: { memberId: string; dueKurus: number; outcome: string }[] = []

  for (const [memberId, ents] of byMember) {
    const ledger = await moneyByEntitlement({ repo: finRepo, clock: systemClock }, ctx, memberId as MemberId)
    let due = 0
    for (const e of ents) due += ledger.get(e.id as string)?.due.amount ?? 0
    if (due <= 0) {
      rows.push({ memberId, dueKurus: 0, outcome: 'zaten borçsuz' })
      continue
    }
    grand += due

    if (!apply) {
      rows.push({ memberId, dueKurus: due, outcome: 'temizlenecek (dry-run)' })
      continue
    }

    const res = await collect(deps, ctx, {
      paymentId: `pay_clr_${runId}_${memberId}`.slice(0, 60),
      memberId: memberId as MemberId,
      branchId,
      amount: money(due),
      method: 'cash',
      receivedAt: systemClock.now(),
      drawerId: null,
      giftCardCode: null,
      note: 'Eski sistemden geçiş — tam ödeme kaydı',
    })
    if (res.ok) {
      cleared++
      rows.push({ memberId, dueKurus: due, outcome: 'temizlendi ✓' })
    } else {
      rows.push({ memberId, dueKurus: due, outcome: `HATA: ${(res.error as { code?: string }).code ?? 'bilinmiyor'}` })
    }
  }

  console.table(rows.map((r) => ({ Üye: r.memberId, Borç: tl(r.dueKurus), Sonuç: r.outcome })))
  console.log(`\nBorçlu aktif üye: ${rows.filter((r) => r.dueKurus > 0).length}`)
  console.log(`Toplam açık bakiye: ${tl(grand)}`)
  console.log(apply ? `\n✅ UYGULANDI — ${cleared} üye borçsuz yapıldı.` : `\nDRY-RUN — hiçbir şey yazılmadı. Uygulamak için: --apply`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
