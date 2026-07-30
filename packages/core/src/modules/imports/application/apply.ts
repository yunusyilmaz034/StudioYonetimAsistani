import {
  instant,
  money,
  type BranchId,
  type EntitlementId,
  type Instant,
  type MemberId,
  type ProductId,
  type Result,
  type TenantContext,
} from '../../../shared'
import { assignSubscription, cancelEntitlement, type EntitlementsDeps } from '../../entitlements'
import { deactivateMember, registerMember, type MembersDeps } from '../../members'
import { buildMembers, buildPackages, toPackageDraft, type Defaults, type Mapping, type NormalizePhone } from '../domain/build'
import type { MatchCandidate } from '../domain/match'
import type { ImportBatch, ImportKind, ProductCandidate } from '../domain/types'
import type { ImportsDeps } from './ports'

// APPLYING AND REVERTING A BATCH — the only part of this module that writes.
//
// It lives in `core`, not in the web app, for the reason every use-case does: it composes two other
// modules through their public doors (`members`, `entitlements`) and it is the code most worth
// testing against a real database. A Server Action's job is to check the role, parse the input and
// call this.
//
// ── An import writes no money ───────────────────────────────────────────────────────────────
//
// No sale, no payment, no till movement (owner, 2026-07-30). These packages were paid for in the old
// system months ago; carrying that money across would mix two systems' revenue into one set of books
// and leave no month comparable to another. `assignSubscription` with `priceAgreed: 0` and
// `collectedAmount: 0` is money-free by construction — it grants the package, applies the opening
// balance, and reaches no finance code at all.

/** The catalogue entry a row resolves to. The caller reads the products; this only grants them. */
export interface ImportProduct {
  readonly productId: ProductId
  readonly snapshot: Parameters<typeof assignSubscription>[2]['productSnapshot']
  readonly freezeDays: number | null
}

export interface Resolution {
  readonly line: number
  /** Whose package. `null` means "create her". */
  readonly memberId: MemberId | null
  /** Rows the operator chose to leave out. Counted as skipped, never silently dropped. */
  readonly skip: boolean
}

export interface ApplyImportInput {
  readonly batchId: string
  readonly kind: ImportKind
  readonly fileName: string
  readonly rows: readonly (readonly string[])[]
  readonly mapping: Mapping
  readonly defaults: Defaults
  readonly headerRowIndex: number
  readonly branchId: BranchId | null
  readonly resolutions: readonly Resolution[]
  readonly existing: readonly MatchCandidate[]
  readonly products: readonly ProductCandidate[]
  readonly catalogue: readonly ImportProduct[]
  readonly normalize: NormalizePhone
  readonly utcOffsetMinutes: number
  readonly appliedBy: string
  /** Folded file-label → productId, decided by the operator on the alias step. */
  readonly aliases?: Readonly<Record<string, ProductId>>
}

export interface ImportFailure {
  readonly line: number
  readonly subject: string
  readonly reason: string
}

export interface ApplyImportResult {
  readonly batchId: string
  readonly createdMemberIds: readonly MemberId[]
  readonly createdEntitlementIds: readonly string[]
  readonly skipped: number
  readonly failed: readonly ImportFailure[]
}

export interface ImportModuleDeps extends ImportsDeps {
  readonly members: MembersDeps
  readonly entitlements: EntitlementsDeps
}

export async function applyImport(
  deps: ImportModuleDeps,
  ctx: TenantContext,
  input: ApplyImportInput,
): Promise<ApplyImportResult> {
  const now = deps.clock.now()
  const rowCount = Math.max(0, input.rows.length - input.headerRowIndex - 1)

  // Opened BEFORE anything is created, so the very first record already has somewhere to be
  // recorded against. See `ports.ts` for why this is not done at the end.
  const opened: ImportBatch = {
    id: input.batchId,
    kind: input.kind,
    fileName: input.fileName,
    rowCount,
    createdMemberIds: [],
    createdEntitlementIds: [],
    skipped: 0,
    status: 'applied',
    appliedAt: instant(now),
    revertedAt: null,
    appliedBy: input.appliedBy,
    revertReason: null,
  }
  await deps.batches.open(ctx, opened, input.appliedBy)

  const out =
    input.kind === 'members' ? await applyMembers(deps, ctx, input) : await applyPackages(deps, ctx, input, instant(now))

  await deps.batches.close(ctx, input.batchId, out.skipped)
  return { batchId: input.batchId, ...out }
}

type Partial = Omit<ApplyImportResult, 'batchId'>

async function applyMembers(
  deps: ImportModuleDeps,
  ctx: TenantContext,
  input: ApplyImportInput,
): Promise<Partial> {
  const built = buildMembers(
    input.rows, input.mapping, input.defaults, input.existing, input.normalize, input.headerRowIndex,
  )
  const createdMemberIds: MemberId[] = []
  const failed: ImportFailure[] = []
  let skipped = built.rejected.length

  for (const row of built.ready) {
    // A phone that already belongs to somebody is skipped, not merged (AD-40). The preview showed
    // her this; refusing again here is the lock behind the door.
    if (row.duplicateOf) {
      skipped++
      continue
    }
    const res = await registerMember(deps.members, ctx, {
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
      await deps.batches.recordCreated(ctx, input.batchId, { memberId: res.value.memberId })
    } else {
      failed.push({ line: row.line, subject: row.draft.fullName, reason: res.error.code })
    }
  }

  return { createdMemberIds, createdEntitlementIds: [], skipped, failed }
}

async function applyPackages(
  deps: ImportModuleDeps,
  ctx: TenantContext,
  input: ApplyImportInput,
  today: Instant,
): Promise<Partial> {
  const built = buildPackages(
    input.rows, input.mapping, input.defaults, input.existing, input.products,
    input.normalize, input.utcOffsetMinutes, today, input.headerRowIndex, input.aliases ?? {},
  )
  const byLine = new Map(input.resolutions.map((r) => [r.line, r]))
  const catalogue = new Map(input.catalogue.map((p) => [p.productId, p]))
  const createdMemberIds: MemberId[] = []
  const createdEntitlementIds: string[] = []
  const failed: ImportFailure[] = []
  let skipped = built.rejected.length

  for (const row of built.ready) {
    const decision = byLine.get(row.line)
    if (decision?.skip) {
      skipped++
      continue
    }

    // Whose package. A phone match decided it; anything else was decided by the operator on the
    // matching step. A row that arrives with neither is not a guess to make now.
    const owner = row.match.kind === 'phone' ? row.match.memberId : (decision?.memberId ?? null)
    const draft = toPackageDraft(row, owner)

    let memberId = owner
    if (memberId === null) {
      const phone = input.normalize(row.phoneE164 ?? '')
      if (!phone) {
        failed.push({ line: row.line, subject: row.memberName, reason: 'yeni üye için telefon gerekli' })
        continue
      }
      const created = await registerMember(deps.members, ctx, {
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
      await deps.batches.recordCreated(ctx, input.batchId, { memberId })
    }

    const product = catalogue.get(row.productId)
    if (!product) {
      failed.push({ line: row.line, subject: row.memberName, reason: 'paket katalogda bulunamadı' })
      continue
    }

    const res = await assignSubscription(deps.entitlements, ctx, {
      memberId,
      productId: row.productId,
      productSnapshot: product.snapshot,
      policyRef: { policyId: row.productId, version: 1 },
      validFrom: draft.validFrom,
      validUntil: draft.validUntil,
      freezeDays: product.freezeDays,
      // The opening balance: she bought eight under the old system, used three there, and arrives
      // with five OF EIGHT. The package keeps its real size (OR-9).
      creditOverride: draft.remainingCredits,
      priceAgreed: money(0),
      collectedAmount: money(0),
      method: 'cash',
      note: draft.note ?? 'Eski sistemden aktarıldı',
    })

    if (res.ok) {
      createdEntitlementIds.push(res.value.entitlementId)
      await deps.batches.recordCreated(ctx, input.batchId, { entitlementId: res.value.entitlementId })
    } else {
      failed.push({ line: row.line, subject: row.memberName, reason: res.error.code })
    }
  }

  return { createdMemberIds, createdEntitlementIds, skipped, failed }
}

export interface RevertImportResult {
  readonly revertedMembers: number
  readonly revertedEntitlements: number
}

/**
 * Undo a batch: cancel what it granted, deactivate whom it created, with a stated reason.
 *
 * The CALLER decides whether it may run — `decideRevert` against freshly gathered activity. This
 * only performs it. Splitting them keeps the rule pure and testable and stops the performing code
 * from quietly acquiring a second opinion about when it is safe.
 *
 * Packages first: a member deactivated while she still holds an active package is a state nothing
 * else in the system produces, and the order costs nothing.
 */
export async function revertImport(
  deps: ImportModuleDeps,
  ctx: TenantContext,
  batch: ImportBatch,
  reason: string,
): Promise<RevertImportResult> {
  let revertedEntitlements = 0
  for (const id of batch.createdEntitlementIds) {
    const res: Result<void, unknown> = await cancelEntitlement(deps.entitlements, ctx, {
      entitlementId: id as EntitlementId,
      reason,
      refundPaymentId: null,
    })
    if (res.ok) revertedEntitlements++
  }

  let revertedMembers = 0
  for (const id of batch.createdMemberIds) {
    const res = await deactivateMember(deps.members, ctx, { memberId: id, reason })
    if (res.ok) revertedMembers++
  }

  await deps.batches.markReverted(ctx, batch.id, deps.clock.now(), reason)
  return { revertedMembers, revertedEntitlements }
}
