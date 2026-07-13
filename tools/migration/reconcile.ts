import {
  available,
  FirestoreEntitlementRepository,
  FirestoreFinanceRepository,
  FirestoreMemberRepository,
  loadMemberAccount,
  systemClock,
  type StudioId,
  type TenantContext,
} from '@studio/core'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

import { writeReport } from './validate'

// RECONCILE — the report a human signs.
//
//   pnpm migrate:reconcile -- --studio=<sid>
//
// This is the step that cannot be skipped and cannot be automated away. **A member with three
// sessions left will absolutely notice if she has eight**, and that is the one number that cannot
// be reconstructed, faked, or apologised for (Doc 1 §16, commitment 3).
//
// What it checks, and what it deliberately does NOT claim:
//
//   • **Members.** How many are in the system, how many are active. Compared against the source
//     count by a human — the script cannot open the old system, and a script that claimed to have
//     checked something it did not check is worse than one that stays quiet.
//
//   • **Credits.** For every active package: `available` versus the six counters it derives from.
//     A drift here means a write path bypassed a transaction (DEBT-004) — it is a **bug**, not a
//     number to correct. It is also the ONLY automated credit check possible for this customer,
//     because BulutGym exports no credit balances at all (owner, 2026-07-13). The real check is
//     the printed per-member list below, read against the owner's own records, by the owner.
//
//   • **Finance.** Every entitlement's legacy money (`priceAgreed` / `paidTotal`) versus the new
//     ledger's sales and payments for that member. After DEBT-021 these must agree to the KURUŞ.
//     They are integers; there is no rounding to hide behind, and "close enough" is not a state
//     money is ever allowed to be in.

const tl = (kurus: number) => (kurus / 100).toLocaleString('tr-TR', { minimumFractionDigits: 2 })

async function main(): Promise<void> {
  const studioId = process.argv
    .slice(2)
    .find((a) => a.startsWith('--studio='))
    ?.split('=')[1] as StudioId | undefined

  if (!studioId) {
    console.error('Kullanım: pnpm migrate:reconcile -- --studio=<studioId>')
    process.exit(2)
  }

  initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID })
  const db = getFirestore()

  const ctx: TenantContext = {
    studioId,
    branchIds: [],
    role: 'owner',
    actor: { type: 'migration', id: 'reconcile' as never },
  }

  const members = await new FirestoreMemberRepository(db).list(ctx)
  const entitlements = await new FirestoreEntitlementRepository(db).listAll(ctx)
  const finDeps = { repo: new FirestoreFinanceRepository(db), clock: systemClock }

  const lines: string[] = []
  const nameOf = new Map(members.map((m) => [m.id, m.fullName]))

  lines.push('# Mutabakat raporu')
  lines.push('')
  lines.push(`Stüdyo: \`${studioId}\` · Tarih: ${new Date().toISOString().slice(0, 19).replace('T', ' ')}`)
  lines.push('')

  // ── 1. MEMBERS ────────────────────────────────────────────────────────────────────────────
  const active = members.filter((m) => m.status === 'active')
  lines.push('## 1. Üyeler')
  lines.push('')
  lines.push(`Sistemdeki üye: **${members.length}** · aktif: **${active.length}**`)
  lines.push('')
  lines.push('> ⚠️ **Bu sayı eski sistemle ELLE karşılaştırılmalıdır.** Script eski sistemi açamaz. ' +
    'Kontrol etmediği bir şeyi kontrol etmiş gibi rapor eden bir araç, hiç rapor etmeyenden kötüdür.')
  lines.push('')

  // ── 2. CREDITS ────────────────────────────────────────────────────────────────────────────
  const activeEnts = entitlements.filter((e) => e.status === 'active')
  const creditDrift: string[] = []

  lines.push('## 2. Kalan krediler — imza gerektiren tablo')
  lines.push('')
  lines.push('| Üye | Paket | Kalan | Geçerlilik sonu |')
  lines.push('|---|---|---|---|')

  for (const e of activeEnts) {
    if (!e.credits) continue // a period package holds no credit balance
    const remaining = available(e.credits)

    // The ledger must agree with itself. It is derived arithmetic, so a disagreement is not a data
    // problem — it is evidence that something wrote `available` outside the transaction.
    const derived =
      e.credits.granted +
      e.credits.restored -
      e.credits.consumed -
      e.credits.held -
      e.credits.revoked -
      e.credits.expired
    if (remaining !== derived) creditDrift.push(`${e.id}: available=${remaining}, türetilen=${derived}`)

    lines.push(
      `| ${nameOf.get(e.memberId) ?? e.memberId} | ${e.productSnapshot.name} | **${remaining}** | ` +
        `${new Date(e.validUntil).toISOString().slice(0, 10)} |`,
    )
  }
  lines.push('')
  lines.push('> **Bu tabloyu owner, kendi kayıtlarıyla satır satır karşılaştırır ve imzalar.** ' +
    'BulutGym kalan kredi ihraç etmiyor (owner, 2026-07-13), dolayısıyla otomatik bir kaynak ' +
    'karşılaştırması YOKTUR ve olduğunu iddia etmiyoruz. Bu paketler elle açıldı; bu tablo, elle ' +
    'açılanın doğru açıldığının tek kanıtıdır.')
  lines.push('')

  if (creditDrift.length) {
    lines.push('### ❌ Kredi defteri tutarsızlığı')
    lines.push('')
    lines.push('```')
    creditDrift.forEach((d) => lines.push(d))
    lines.push('```')
    lines.push('')
    lines.push('> Bu bir **hata**, düzeltilecek bir sayı değil (DEBT-004). Bir yazma yolu ' +
      'transaction’ı atlamış demektir. `docs/RUNBOOK.md` → `credit_ledger_drift`.')
    lines.push('')
  }

  // ── 3. FINANCE (DEBT-021) ─────────────────────────────────────────────────────────────────
  lines.push('## 3. Finans — legacy alanlar ↔ yeni ledger')
  lines.push('')

  const legacyByMember = new Map<string, { sold: number; collected: number }>()
  for (const e of entitlements) {
    const cur = legacyByMember.get(e.memberId) ?? { sold: 0, collected: 0 }
    legacyByMember.set(e.memberId, {
      sold: cur.sold + e.priceAgreed.amount,
      collected: cur.collected + (e.manualPayment?.collectedAmount.amount ?? 0),
    })
  }

  const mismatches: string[] = []
  let totalLegacySold = 0
  let totalLedgerSold = 0

  for (const [memberId, legacy] of legacyByMember) {
    const account = await loadMemberAccount(finDeps, ctx, memberId as never)
    totalLegacySold += legacy.sold
    totalLedgerSold += account.totalSoldKurus

    // Kuruş, not "about". Money is an integer; there is no rounding error to forgive.
    if (legacy.sold !== account.totalSoldKurus || legacy.collected !== account.totalPaidKurus) {
      mismatches.push(
        `${nameOf.get(memberId as never) ?? memberId} — legacy satış ${tl(legacy.sold)} ₺ / ledger ${tl(account.totalSoldKurus)} ₺ · ` +
          `legacy tahsilat ${tl(legacy.collected)} ₺ / ledger ${tl(account.totalPaidKurus)} ₺`,
      )
    }
  }

  lines.push(`Legacy toplam satış: **${tl(totalLegacySold)} ₺**`)
  lines.push(`Ledger toplam satış: **${tl(totalLedgerSold)} ₺**`)
  lines.push('')

  if (mismatches.length) {
    lines.push('### ❌ Uyuşmazlık — BLOKLAYICIDIR')
    lines.push('')
    lines.push('```')
    mismatches.forEach((m) => lines.push(m))
    lines.push('```')
    lines.push('')
    lines.push('> Cutover **durdurulur**. Uyuşmazlık not düşülmez, çözülür (Doc 8 §7).')
  } else {
    lines.push('### ✅ Legacy para alanları ile yeni ledger **kuruşu kuruşuna** aynı.')
  }

  const path = writeReport('reconcile.md', `${lines.join('\n')}\n`)
  const blocking = creditDrift.length + mismatches.length

  console.log(`Üye ${members.length} · aktif paket ${activeEnts.length}`)
  console.log(`Kredi tutarsızlığı: ${creditDrift.length} · finans uyuşmazlığı: ${mismatches.length}`)
  console.log(`Rapor: ${path}`)

  if (blocking) {
    console.error('\n❌ MUTABAKAT BAŞARISIZ. Cutover durur.')
    process.exit(1)
  }
  console.log('\n✅ Mutabakat temiz. İmza için hazır.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
