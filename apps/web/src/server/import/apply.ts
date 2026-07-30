import 'server-only'

import {
  assignSubscription,
  buildMembers,
  cancelEntitlement,
  buildPackages,
  deactivateMember,
  FirestoreEntitlementRepository,
  FirestoreMemberRepository,
  money,
  registerMember,
  systemClock,
  toPackageDraft,
  type BranchId,
  type Defaults,
  type EntitlementId,
  type ImportBatch,
  type ImportKind,
  type Mapping,
  type MatchCandidate,
  type MemberId,
  type NormalizePhone,
  type PackageRow,
  type ProductCandidate,
  type ProductId,
  type TenantContext,
} from '@studio/core'

import { adminDb } from '../firebase-admin'
import { recordCreated } from './batches'

// APPLYING A BATCH — the only step that writes.
//
// ── What an import writes, and what it must never write ─────────────────────────────────────
//
// Members and packages. **No sale, no payment, no till movement.** The owner's rule, 2026-07-30:
// these packages were paid for in the old system, months ago, and carrying that money across would
// mix two systems' revenue into one set of books — after which no month is comparable to any other.
// We cleared 44.473 TL of exactly that kind of noise out of this studio's dashboard three days
// before this was written.
//
// `assignSubscription` with `priceAgreed: 0` and `collectedAmount: 0` is money-free by construction:
// it grants the package, applies the opening balance, and reaches no finance code at all.
//
// ── Why the loop is not a transaction, and why that is survivable ───────────────────────────
//
// Seventy members and their packages cannot be one Firestore transaction (500 writes, and each
// member is already a transaction of its own for phone uniqueness). So a failure part-way leaves a
// PARTIAL batch.
//
// That is survivable only because the batch record is written BEFORE the loop and each created id is
// appended to it AS IT IS CREATED. Recording the ids at the end instead would mean a crash in row
// forty leaves thirty-nine members in the studio and no record that they came from an import —
// orphans nobody can find, let alone undo. One extra small write per row is nothing next to that,
// for an operation that runs a handful of times in a studio's life.
//
// A half-import you can revert in one click is a far better position than an atomic import you
// cannot attempt at all.

const productDeps = () => ({ repo: new FirestoreEntitlementRepository(adminDb()), clock: systemClock })
const memberDeps = () => ({
  repo: new FirestoreMemberRepository(adminDb()),
  clock: systemClock,
  // The log never claims reception typed these women in one by one (#5). A year from now, "where did
  // this member come from?" has an answer, and the answer is this batch.
  source: 'migration' as const,
})

export interface Resolution {
  readonly line: number
  readonly memberId: MemberId | null
  readonly skip: boolean
}

export interface ApplyInput {
  readonly ctx: TenantContext
  readonly batchId: string
  readonly correlationId: string
  readonly kind: ImportKind
  readonly rows: readonly (readonly string[])[]
  readonly mapping: Mapping
  readonly defaults: Defaults
  readonly headerRowIndex: number
  readonly branchId: BranchId | null
  readonly resolutions: readonly Resolution[]
  readonly existing: readonly MatchCandidate[]
  readonly products: readonly ProductCandidate[]
  readonly normalize: NormalizePhone
  readonly utcOffsetMinutes: number
}

export interface ApplyResult {
  readonly createdMemberIds: readonly MemberId[]
  readonly createdEntitlementIds: readonly string[]
  readonly skipped: number
  readonly failed: readonly { readonly line: number; readonly subject: string; readonly reason: string }[]
}

export async function applyImportBatch(input: ApplyInput): Promise<ApplyResult> {
  return input.kind === 'members' ? applyMembers(input) : applyPackages(input)
}

async function applyMembers(input: ApplyInput): Promise<ApplyResult> {
  const built = buildMembers(
    input.rows, input.mapping, input.defaults, input.existing, input.normalize, input.headerRowIndex,
  )
  const createdMemberIds: MemberId[] = []
  const failed: ApplyResult['failed'] = []
  let skipped = built.rejected.length

  for (const row of built.ready) {
    // A phone that already belongs to somebody is skipped, not merged (AD-40). The preview showed
    // her this; doing it again here is the lock behind the door.
    if (row.duplicateOf) {
      skipped++
      continue
    }
    const res = await registerMember(memberDeps(), input.ctx, {
      fullName: row.draft.fullName,
      phone: row.phoneE164,
      homeBranchId: input.branchId,
      email: row.draft.email,
      birthDate: row.draft.birthDate,
      notes: row.draft.notes,
      emergencyContact: null,
    })
    if (res.ok) {
      createdMemberIds.push(res.value.memberId)
      await recordCreated(input.ctx, input.batchId, { memberId: res.value.memberId })
    } else {
      (failed as { line: number; subject: string; reason: string }[]).push({
        line: row.line, subject: row.draft.fullName, reason: res.error.code,
      })
    }
  }

  return { createdMemberIds, createdEntitlementIds: [], skipped, failed }
}

async function applyPackages(input: ApplyInput): Promise<ApplyResult> {
  const built = buildPackages(
    input.rows, input.mapping, input.defaults, input.existing, input.products,
    input.normalize, input.utcOffsetMinutes, systemClock.now(), input.headerRowIndex,
  )
  const byLine = new Map(input.resolutions.map((r) => [r.line, r]))
  const createdMemberIds: MemberId[] = []
  const createdEntitlementIds: string[] = []
  const failed: { line: number; subject: string; reason: string }[] = []
  let skipped = built.rejected.length

  const catalogue = await loadProductDocs(input.ctx, built.ready)

  for (const row of built.ready) {
    const decision = byLine.get(row.line)
    if (decision?.skip) {
      skipped++
      continue
    }

    // Whose package. A phone match decided it; anything else was decided by the operator on the
    // matching step. A row that reached here with neither is a bug, not a guess to make now.
    const owner =
      row.match.kind === 'phone' ? row.match.memberId : (decision?.memberId ?? null)
    const draft = toPackageDraft(row, owner)

    let memberId = owner
    if (memberId === null) {
      const phone = input.normalize(row.phoneE164 ?? '')
      if (!phone) {
        failed.push({ line: row.line, subject: row.memberName, reason: 'yeni üye için telefon gerekli' })
        continue
      }
      const created = await registerMember(memberDeps(), input.ctx, {
        fullName: row.memberName,
        phone: phone.e164,
        homeBranchId: input.branchId,
        email: null, birthDate: null, notes: null, emergencyContact: null,
      })
      if (!created.ok) {
        failed.push({ line: row.line, subject: row.memberName, reason: created.error.code })
        continue
      }
      memberId = created.value.memberId
      createdMemberIds.push(memberId)
      await recordCreated(input.ctx, input.batchId, { memberId })
    }

    const product = catalogue.get(row.productId)
    if (!product) {
      failed.push({ line: row.line, subject: row.memberName, reason: 'paket katalogda bulunamadı' })
      continue
    }

    const res = await assignSubscription(productDeps(), input.ctx, {
      memberId,
      productId: row.productId,
      productSnapshot: product.snapshot,
      policyRef: { policyId: row.productId, version: 1 },
      validFrom: draft.validFrom,
      validUntil: draft.validUntil,
      freezeDays: product.freezeDays,
      // The opening balance: she bought eight under the old system, used three there, arrives with
      // five OF EIGHT. The package keeps its real size (OR-9).
      creditOverride: draft.remainingCredits,
      // Money-free, deliberately and by construction. See the note at the top of this file.
      priceAgreed: money(0),
      collectedAmount: money(0),
      method: 'cash',
      note: draft.note ?? 'Eski sistemden aktarıldı',
    })

    if (res.ok) {
      createdEntitlementIds.push(res.value.entitlementId)
      await recordCreated(input.ctx, input.batchId, { entitlementId: res.value.entitlementId })
    } else {
      failed.push({ line: row.line, subject: row.memberName, reason: res.error.code })
    }
  }

  return { createdMemberIds, createdEntitlementIds, skipped, failed }
}

interface ProductDoc {
  readonly snapshot: Parameters<typeof assignSubscription>[2]['productSnapshot']
  readonly freezeDays: number | null
}

async function loadProductDocs(
  ctx: TenantContext,
  rows: readonly PackageRow[],
): Promise<Map<ProductId, ProductDoc>> {
  const ids = [...new Set(rows.map((r) => r.productId))]
  const out = new Map<ProductId, ProductDoc>()
  for (const id of ids) {
    const snap = await adminDb().doc(`studios/${ctx.studioId}/products/${id}`).get()
    if (!snap.exists) continue
    const p = snap.data()!
    const isCredit = p.type === 'credit'
    out.set(id, {
      snapshot: {
        productId: id,
        name: String(p.name),
        category: p.category,
        grant: isCredit
          ? { kind: 'credits', credits: Number(p.creditCount ?? 0), validForDays: Number(p.durationDays ?? 30) }
          : { kind: 'period', durationDays: Number(p.durationDays ?? 30), access: 'unlimited' },
        listPrice: money(Number(p.priceInKurus ?? 0)),
        serviceIds: p.serviceIds ?? [],
        cancellationAllowanceCount: p.cancellationAllowanceCount ?? null,
        dailyReservationLimit: p.dailyReservationLimit ?? null,
        activeReservationLimit: p.activeReservationLimit ?? null,
        entryAllowance: p.entryAllowance ?? null,
      },
      freezeDays: Number(p.freezeAllowanceDays ?? 0) > 0 ? Number(p.freezeAllowanceDays) : null,
    })
  }
  return out
}

// ── REVERSAL ────────────────────────────────────────────────────────────────────────────────

export interface RevertResult {
  readonly revertedMembers: number
  readonly revertedEntitlements: number
}

export async function revertImportBatch(
  ctx: TenantContext,
  batch: ImportBatch,
  reason: string,
): Promise<RevertResult> {
  // Packages first. A member deactivated while she still holds an active package is a state nothing
  // else in the system produces, and the order costs nothing.
  let revertedEntitlements = 0
  for (const id of batch.createdEntitlementIds) {
    const res = await cancelEntitlement(productDeps(), ctx, {
      entitlementId: id as EntitlementId,
      reason,
      refundPaymentId: null,
    })
    if (res.ok) revertedEntitlements++
  }

  let revertedMembers = 0
  for (const id of batch.createdMemberIds) {
    const res = await deactivateMember(memberDeps(), ctx, { memberId: id, reason })
    if (res.ok) revertedMembers++
  }

  return { revertedMembers, revertedEntitlements }
}
