'use server'

import {
  applyImport,
  buildMembers,
  buildPackages,
  decideRevert,
  fieldsFor,
  missingRequired,
  newImportBatchId,
  normalizePhone,
  revertImport,
  suggestMapping,
  systemClock,
  type BranchId,
  type Defaults,
  type EntitlementActivity,
  type ImportKind,
  type Mapping,
  type MatchCandidate,
  type MemberActivity,
  type MemberId,
  type NormalizePhone,
  type ProductCandidate,
  type ProductId,
  type RevertVerdict,
} from '@studio/core'
import { z } from 'zod'

import { requireTenantContext } from '../auth'
import { adminDb } from '../firebase-admin'
import { FileTooLargeError, FileUnreadableError, readUpload } from '../import/read-file'
import { collectRevertEvidence } from '../import/evidence'
import { importDeps, loadCatalogue } from '../import/deps'

// THE IMPORT WIZARD (owner, 2026-07-30).
//
// Owner-only, every step. Reception does not import: a bad import touches the whole roster at once,
// and the person who should carry that is the person who owns the consequences. It is also the
// reason this whole feature is desktop-only by design — nobody maps forty columns on a phone.
//
// The steps are separate actions on purpose. Each one returns what the next needs and writes
// NOTHING until the last, so the operator can go back, change a mapping, and look again without any
// of it having reached the studio.

const OWNER = ['owner', 'platform_admin'] as const
const STUDIO_UTC_OFFSET_MIN = 180

const KIND = z.enum(['members', 'member_packages'])
const MAPPING = z.record(z.string(), z.number().int().min(0).nullable())
const DEFAULTS = z.record(z.string(), z.string())

/** The phone normaliser, handed to the pure builder so it never reaches into the members module. */
const normalize: NormalizePhone = (raw) => {
  const r = normalizePhone(raw)
  return r.ok ? { e164: r.value.e164, normalized: r.value.normalized } : null
}

async function loadMembers(studioId: string): Promise<readonly MatchCandidate[]> {
  const snap = await adminDb().collection(`studios/${studioId}/members`).get()
  return snap.docs.map((d) => {
    const x = d.data()
    return {
      memberId: d.id as MemberId,
      fullName: String(x.fullName ?? ''),
      phoneNormalized: String(x.phoneNormalized ?? ''),
    }
  })
}

async function loadProducts(studioId: string): Promise<readonly ProductCandidate[]> {
  const snap = await adminDb().collection(`studios/${studioId}/products`).get()
  return snap.docs
    .filter((d) => d.data().active !== false)
    .map((d) => ({ productId: d.id as ProductId, name: String(d.data().name ?? '') }))
}

// ── STEP 2: read the file ───────────────────────────────────────────────────────────────────

export interface FilePreview {
  readonly fileName: string
  /** Every row, so a later step can re-read without a second upload. */
  readonly rows: readonly (readonly string[])[]
  readonly sheetNames: readonly string[]
  readonly truncated: boolean
  readonly error: string | null
}

export async function readImportFileAction(input: unknown): Promise<FilePreview> {
  const p = z.object({ fileName: z.string().min(1), base64: z.string().min(1) }).parse(input)
  await requireTenantContext(OWNER)

  const empty = { fileName: p.fileName, rows: [], sheetNames: [], truncated: false }
  try {
    const data = await readUpload(p.fileName, Buffer.from(p.base64, 'base64'))
    if (data.rows.length === 0) return { ...empty, error: 'Dosyada okunabilir satır yok.' }
    return { fileName: p.fileName, rows: data.rows, sheetNames: data.sheetNames, truncated: data.truncated, error: null }
  } catch (e) {
    if (e instanceof FileTooLargeError || e instanceof FileUnreadableError) return { ...empty, error: e.message }
    return { ...empty, error: 'Dosya okunamadı.' }
  }
}

// ── STEP 3: what the columns probably mean ──────────────────────────────────────────────────

export async function suggestMappingAction(input: unknown) {
  const p = z.object({ kind: KIND, header: z.array(z.string()) }).parse(input)
  await requireTenantContext(OWNER)
  return {
    mapping: suggestMapping(p.header, fieldsFor(p.kind)),
    fields: fieldsFor(p.kind).map((f) => ({ key: f.key, label: f.label, required: f.required, hint: f.hint ?? null })),
  }
}

// ── STEPS 4–6: what WOULD happen. Still writes nothing. ─────────────────────────────────────

export async function previewWizardAction(input: unknown) {
  const p = z
    .object({
      kind: KIND,
      rows: z.array(z.array(z.string())),
      mapping: MAPPING,
      defaults: DEFAULTS,
      headerRowIndex: z.number().int().min(0),
    })
    .parse(input)
  const ctx = await requireTenantContext(OWNER)

  const missing = missingRequired(p.kind, p.mapping as Mapping, p.defaults as Defaults)
  const existing = await loadMembers(ctx.studioId)

  if (p.kind === 'members') {
    const out = buildMembers(p.rows, p.mapping as Mapping, p.defaults as Defaults, existing, normalize, p.headerRowIndex)
    return { kind: 'members' as const, missing, members: out, packages: null }
  }

  const products = await loadProducts(ctx.studioId)
  const out = buildPackages(
    p.rows,
    p.mapping as Mapping,
    p.defaults as Defaults,
    existing,
    products,
    normalize,
    STUDIO_UTC_OFFSET_MIN,
    systemClock.now(),
    p.headerRowIndex,
  )
  return {
    kind: 'member_packages' as const,
    missing,
    members: null,
    packages: {
      ...out,
      // The roster the matching step needs to offer alternatives. Names only — the screen shows a
      // name to choose from, and there is no reason for a phone number to travel to the browser.
      roster: existing.map((m) => ({ memberId: m.memberId, fullName: m.fullName })),
    },
  }
}

// ── STEP 7: commit ──────────────────────────────────────────────────────────────────────────

const RESOLUTION = z.object({
  line: z.number().int(),
  /** The member this row's package goes to; null means "create her". */
  memberId: z.string().nullable(),
  /** Rows the operator chose to leave out. Counted as skipped, never silently dropped. */
  skip: z.boolean(),
})

export async function applyWizardAction(input: unknown) {
  const p = z
    .object({
      kind: KIND,
      fileName: z.string().min(1),
      rows: z.array(z.array(z.string())),
      mapping: MAPPING,
      defaults: DEFAULTS,
      headerRowIndex: z.number().int().min(0),
      branchId: z.string().nullable(),
      resolutions: z.array(RESOLUTION),
    })
    .parse(input)
  const ctx = await requireTenantContext(OWNER)

  const products = p.kind === 'member_packages' ? await loadProducts(ctx.studioId) : []

  return applyImport(importDeps(), ctx, {
    batchId: newImportBatchId(),
    kind: p.kind as ImportKind,
    fileName: p.fileName,
    rows: p.rows,
    mapping: p.mapping as Mapping,
    defaults: p.defaults as Defaults,
    headerRowIndex: p.headerRowIndex,
    branchId: (p.branchId ?? null) as BranchId | null,
    resolutions: p.resolutions.map((r) => ({ ...r, memberId: (r.memberId ?? null) as MemberId | null })),
    existing: await loadMembers(ctx.studioId),
    products,
    catalogue: await loadCatalogue(ctx, products.map((x) => x.productId)),
    normalize,
    utcOffsetMinutes: STUDIO_UTC_OFFSET_MIN,
    appliedBy: ctx.actor.id ?? 'unknown',
  })
}

// ── UNDO ────────────────────────────────────────────────────────────────────────────────────

export async function listImportBatchesAction() {
  const ctx = await requireTenantContext(OWNER)
  return importDeps().batches.list(ctx, 25)
}

export interface RevertCheck {
  readonly verdict: RevertVerdict
  readonly members: readonly MemberActivity[]
  readonly entitlements: readonly EntitlementActivity[]
}

/** Can this batch still be undone? Read-only — the screen calls it before offering the button. */
export async function checkRevertAction(input: unknown): Promise<RevertCheck | { error: string }> {
  const p = z.object({ batchId: z.string().min(1) }).parse(input)
  const ctx = await requireTenantContext(OWNER)

  const batch = await importDeps().batches.get(ctx, p.batchId)
  if (!batch) return { error: 'Aktarım bulunamadı.' }

  const evidence = await collectRevertEvidence(ctx, batch)
  return { verdict: decideRevert(batch, evidence.members, evidence.entitlements), ...evidence }
}

export async function revertImportAction(input: unknown) {
  const p = z.object({ batchId: z.string().min(1), reason: z.string().min(1) }).parse(input)
  const ctx = await requireTenantContext(OWNER)

  const batch = await importDeps().batches.get(ctx, p.batchId)
  if (!batch) return { ok: false as const, error: 'Aktarım bulunamadı.' }

  // Checked again HERE, not only on the screen. The screen already showed her the verdict; this is
  // the lock behind the door, so nothing is undone because a button was enabled by a stale render.
  const evidence = await collectRevertEvidence(ctx, batch)
  const verdict = decideRevert(batch, evidence.members, evidence.entitlements)
  if (!verdict.ok) {
    return {
      ok: false as const,
      error:
        verdict.code === 'already_reverted'
          ? 'Bu aktarım zaten geri alınmış.'
          : 'Bu aktarımın üzerine işlem yapılmış; geri alınamaz.',
      verdict,
    }
  }

  const done = await revertImport(importDeps(), ctx, batch, p.reason)
  return { ok: true as const, ...done }
}
