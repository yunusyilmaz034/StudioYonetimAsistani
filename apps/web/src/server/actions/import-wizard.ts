'use server'

import {
  applyImport,
  buildMembers,
  foldAliases,
  suggestProducts,
  unknownLabels,
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
// A cell is coerced, not demanded. `z.array(z.string())` used to reject a whole file because one
// blank cell arrived as null — a validation error that named no row, no column and no cause, on the
// one screen where the operator has no way to investigate. Anything unreadable becomes an empty
// cell, and an empty cell is something the preview can show and explain.
const CELL = z.preprocess((v) => (v == null ? '' : typeof v === 'string' ? v : String(v)), z.string())
const ROWS = z.array(z.array(CELL))
const MAPPING = z.record(z.string(), z.number().int().min(0).nullable())
const DEFAULTS = z.record(z.string(), z.string())
// File label → productId, decided by the operator. '' means 'skip these rows'.
const ALIASES = z.record(z.string(), z.string())

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

/**
 * Members who already hold a live package, and what it is.
 *
 * Shown as a warning next to the row, never as a refusal (owner, 2026-07-30). A second package on
 * top of a live one is USUALLY a duplicate — the same file imported twice, or a member already
 * entered by hand — but it is legitimately how a renewal and a hybrid look, and refusing it would
 * block real work to prevent a mistake the operator can see for herself. So it is said out loud and
 * left to her.
 */
async function loadActivePackages(studioId: string): Promise<Record<string, string>> {
  const snap = await adminDb().collection(`studios/${studioId}/entitlements`).where('status', '==', 'active').get()
  const now = Date.now()
  const out: Record<string, string> = {}
  for (const doc of snap.docs) {
    const x = doc.data()
    const until = x.validUntil?.toMillis?.() ?? Number(x.validUntil ?? 0)
    if (until <= now) continue // expired but not yet swept — not something to warn about
    const memberId = String(x.memberId ?? '')
    if (!memberId) continue
    const line = `${String(x.productSnapshot?.name ?? 'paket')} · ${new Date(until).toLocaleDateString('tr-TR')}`
    out[memberId] = out[memberId] ? `${out[memberId]}, ${line}` : line
  }
  return out
}

async function loadProducts(studioId: string) {
  const snap = await adminDb().collection(`studios/${studioId}/products`).get()
  return snap.docs
    .filter((d) => d.data().active !== false)
    .map((d) => ({
      productId: d.id as ProductId,
      name: String(d.data().name ?? ''),
      // Shape, for suggesting a product from a label like "6 AY". Never used to DECIDE one.
      durationDays: Number(d.data().durationDays ?? 0),
      creditCount: d.data().creditCount == null ? null : Number(d.data().creditCount),
    }))
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
      rows: ROWS,
      mapping: MAPPING,
      defaults: DEFAULTS,
      aliases: ALIASES.optional(),
      headerRowIndex: z.number().int().min(0),
    })
    .parse(input)
  const ctx = await requireTenantContext(OWNER)

  const missing = missingRequired(p.kind, p.mapping as Mapping, p.defaults as Defaults)
  const existing = await loadMembers(ctx.studioId)

  if (p.kind === 'members') {
    const out = buildMembers(p.rows, p.mapping as Mapping, p.defaults as Defaults, existing, normalize, p.headerRowIndex)
    return {
      kind: 'members' as const,
      missing,
      members: out,
      packages: null,
      unknown: [],
      catalogueOptions: [],
      activePackages: {} as Record<string, string>,
    }
  }

  const products = await loadProducts(ctx.studioId)
  const aliases = foldAliases(p.aliases ?? {})
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
    aliases,
  )

  // The distinct labels the catalogue does not know, each with the rows it covers and the products
  // that plausibly mean it. The operator answers once per label; nothing here decides for her.
  const at = (p.mapping as Mapping).productName
  const labels =
    at == null ? [] : p.rows.slice(p.headerRowIndex + 1).map((r) => String(r[at] ?? '').trim())
  // FOLDED keys, like the lookup the builder uses. Passing the raw ones made every answered label
  // read as still-unanswered, and the wizard bounced the operator back to the alias step for ever
  // (2026-07-30) — the loading spinner cleared and the screen simply did not move.
  const unknown = unknownLabels(labels, products, aliases).map((u) => ({
    ...u,
    suggestions: suggestProducts(u.label, products),
  }))
  return {
    kind: 'member_packages' as const,
    missing,
    members: null,
    unknown,
    activePackages: await loadActivePackages(ctx.studioId),
    catalogueOptions: products.map((x) => ({ productId: x.productId, name: x.name })),
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
  /** Typed on the matching step when the row creates a member and the file carried no phone. */
  phone: z.string().optional(),
})

export async function applyWizardAction(input: unknown) {
  const p = z
    .object({
      kind: KIND,
      fileName: z.string().min(1),
      rows: ROWS,
      mapping: MAPPING,
      defaults: DEFAULTS,
      aliases: ALIASES.optional(),
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
    // `exactOptionalPropertyTypes` — an absent phone must be ABSENT, not `undefined`. Spreading a
    // parsed object keeps the key with an undefined value, which the Resolution type refuses.
    resolutions: p.resolutions.map((r) => ({
      line: r.line,
      memberId: (r.memberId ?? null) as MemberId | null,
      skip: r.skip,
      ...(r.phone ? { phone: r.phone } : {}),
    })),
    existing: await loadMembers(ctx.studioId),
    products,
    aliases: foldAliases(p.aliases ?? {}),
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
