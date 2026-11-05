'use server'

import { createHash, randomBytes, randomUUID } from 'node:crypto'

import {
  documentRuleFor,
  DocumentRules,
  E_ARCHIVE_STALE_MS,
  FirestoreFinanceRepository,
  FirestoreInvoiceRepository,
  FirestoreMemberRepository,
  InvoiceDocuments,
  loadExcludedMemberIds,
  markInvoiceIssued,
  parseInvoicePolicy,
  requestEArchive,
  revertInvoice,
  setMemberNationalId,
  systemClock,
  type DocumentRule,
  type DomainError,
  type InvoiceDocument,
  type InvoicePolicy,
  type MemberId,
  type Result,
} from '@studio/core'
import { Timestamp } from 'firebase-admin/firestore'
import { headers } from 'next/headers'
import { z } from 'zod'

import { requireTenantContext } from '../auth'
import { adminDb, adminStorage, storageBucketName } from '../firebase-admin'
import { reportPinIsDefault, reportsUnlocked } from '../report-pin'

// FATURA TAKİBİ (owner, 2026-11-03).
//
// *"Fatura kesmemiz gerekiyor, sistemde en azından takibi olsun; ayrı bir ekran olsun, PIN ile
// korunsun. Kişi ad soyad, TC varsa yoksa 11 tane 1, ödeme yöntemi, tarih; fatura kestiysek
// tikleyelim, fatura kesildi notu olsun."*
//
// The system does not cut the invoice — it remembers which payments have had one cut. One row per
// live (not voided) payment in the range. The PIN is the money reports' PIN (`report-pin.ts`): one
// unlock opens both, and every action here — reads AND writes — checks it, because the list carries
// TC kimlik numbers and the writes are made from behind the same door.

const OWNER = ['owner'] as const

/** Printed where a member has given no TC kimlik — what the e-arşiv portal accepts for "unknown". */
const PLACEHOLDER_TC = '11111111111'

export interface InvoiceRow {
  readonly paymentId: string
  readonly memberId: string
  readonly receivedAt: number
  readonly fullName: string
  /** The member's own TC kimlik, or null — the screen shows the placeholder then. */
  readonly nationalId: string | null
  readonly method: string
  readonly amountKurus: number
  readonly issued: boolean
  readonly issuedAt: number | null
  readonly note: string | null
  /** What the invoice was cut for, as typed at the tick — may differ from the payment (owner). */
  readonly invoicedKurus: number | null
  /** FT-2 (OR-132) — which document this method gets by the studio's rule. */
  readonly rule: DocumentRule
  /** What was cut; null on a tick from before FT-2 ("Elle işaretli"). */
  readonly document: InvoiceDocument | null
  readonly byParasut: boolean
  readonly documentNo: string | null
  /** The e-Arşiv request in flight or failed. `stale`: nobody heard back in 15 min — may be pressed again. */
  readonly eArchive: { readonly status: 'pending' | 'failed'; readonly error: string | null; readonly stale: boolean; readonly invoicedKurus: number } | null
}

export interface InvoiceSetup {
  /** e-Arşiv can be requested: the accountant's VAT rate is set and Paraşüt is connected. */
  readonly eArchiveReady: boolean
  readonly receiptLimitKurus: number | null
  readonly environment: 'staging' | 'production'
}

export type InvoiceList =
  | { readonly locked: true; readonly varsayilanPin: boolean }
  | { readonly locked: false; readonly rows: readonly InvoiceRow[]; readonly placeholder: string; readonly setup: InvoiceSetup }

async function unlocked(): Promise<{ ok: true; ctx: Awaited<ReturnType<typeof requireTenantContext>> } | { ok: false }> {
  const ctx = await requireTenantContext(OWNER)
  return (await reportsUnlocked(String(ctx.studioId), String(ctx.actor.id))) ? { ok: true, ctx } : { ok: false }
}

const LOCKED: Result<void, DomainError> = { ok: false, error: { code: 'operation_not_applicable' } }

export async function loadInvoicesAction(input: unknown): Promise<InvoiceList> {
  const p = z.object({ fromMs: z.number(), toMs: z.number() }).parse(input)
  const ctx = await requireTenantContext(OWNER)
  if (!(await reportsUnlocked(String(ctx.studioId), String(ctx.actor.id)))) {
    return { locked: true, varsayilanPin: await reportPinIsDefault(String(ctx.studioId)) }
  }
  const db = adminDb()
  const [payments, excluded] = await Promise.all([
    new FirestoreFinanceRepository(db).listPaymentsBetween(ctx, p.fromMs, p.toMs),
    loadExcludedMemberIds(db, ctx.studioId),
  ])
  // Test accounts are not customers; a voided payment has nothing to invoice.
  const live = payments.filter((x) => !x.voided && !excluded.has(String(x.memberId)))
  const memberIds = [...new Set(live.map((x) => String(x.memberId)))]
  const invoiceRepo = new FirestoreInvoiceRepository(db)
  const [marks, memberSnaps, policy, connected] = await Promise.all([
    invoiceRepo.listInvoiceMarks(ctx, live.map((x) => x.id)),
    memberIds.length === 0
      ? Promise.resolve([])
      : db.getAll(...memberIds.map((id) => db.doc(`studios/${ctx.studioId}/members/${id}`))),
    invoiceRepo.getInvoicePolicy(ctx),
    parasutConnected(String(ctx.studioId)),
  ])
  const now = systemClock.now()
  const mark = new Map(marks.map((m) => [m.paymentId, m]))
  const who = new Map(
    memberSnaps.map((s) => [
      s.id,
      {
        name: String(s.get('fullName') ?? '(silinmiş üye)'),
        tc: typeof s.get('nationalId') === 'string' && s.get('nationalId') ? String(s.get('nationalId')) : null,
      },
    ]),
  )

  const rows: InvoiceRow[] = [...live]
    .sort((a, b) => b.receivedAt - a.receivedAt)
    .map((x) => {
      const m = mark.get(x.id)
      const w = who.get(String(x.memberId))
      return {
        paymentId: x.id,
        memberId: String(x.memberId),
        receivedAt: x.receivedAt,
        fullName: w?.name ?? '(silinmiş üye)',
        nationalId: w?.tc ?? null,
        method: x.method,
        amountKurus: x.amount.amount,
        issued: m?.issued === true,
        issuedAt: m?.issuedAt ?? null,
        note: m?.note ?? null,
        invoicedKurus: m?.issued && m.invoicedAmount ? m.invoicedAmount.amount : null,
        rule: documentRuleFor(policy, x.method),
        document: m?.issued ? m.document : null,
        byParasut: m?.issued === true && m.provider === 'parasut',
        documentNo: m?.issued ? m.documentNo : null,
        eArchive:
          !m?.issued && m?.eArchive
            ? {
                status: m.eArchive.status,
                error: m.eArchive.error,
                stale: m.eArchive.status === 'pending' && now - m.eArchive.requestedAt >= E_ARCHIVE_STALE_MS,
                invoicedKurus: m.eArchive.invoicedAmount.amount,
              }
            : null,
      }
    })
  return {
    locked: false,
    rows,
    placeholder: PLACEHOLDER_TC,
    setup: {
      eArchiveReady: policy.vatRatePercent !== null && policy.parasut.companyId !== null && connected,
      receiptLimitKurus: policy.receiptLimitKurus,
      environment: policy.parasut.environment,
    },
  }
}

function deps() {
  const db = adminDb()
  return { repo: new FirestoreFinanceRepository(db), invoices: new FirestoreInvoiceRepository(db), clock: systemClock }
}

export async function markInvoiceIssuedAction(input: unknown): Promise<Result<void, DomainError>> {
  const p = z
    .object({
      paymentId: z.string().min(1),
      note: z.string().max(300).nullable(),
      invoicedKurus: z.number().int(),
      document: z.enum(InvoiceDocuments as [InvoiceDocument, ...InvoiceDocument[]]),
    })
    .parse(input)
  const u = await unlocked()
  if (!u.ok) return LOCKED
  return markInvoiceIssued(deps(), u.ctx, { paymentId: p.paymentId, note: p.note, invoicedKurus: p.invoicedKurus, document: p.document })
}

// ── FT-2 · e-Arşiv (OR-132) — always a human's press, one confirmation for the batch. ────────────

export interface EArchiveRequestResult {
  readonly paymentId: string
  readonly ok: boolean
  readonly error: DomainError | null
}

export async function requestEArchiveAction(input: unknown): Promise<readonly EArchiveRequestResult[]> {
  const p = z
    .object({ items: z.array(z.object({ paymentId: z.string().min(1), invoicedKurus: z.number().int() })).min(1).max(30) })
    .parse(input)
  const u = await unlocked()
  if (!u.ok) return p.items.map((i) => ({ paymentId: i.paymentId, ok: false, error: { code: 'operation_not_applicable' } }))
  const d = deps()
  const out: EArchiveRequestResult[] = []
  // One at a time: each is its own transaction, and a refusal on one never blocks the others.
  for (const i of p.items) {
    const r = await requestEArchive(d, u.ctx, { paymentId: i.paymentId, invoicedKurus: i.invoicedKurus, newRequestId: randomUUID() })
    out.push({ paymentId: i.paymentId, ok: r.ok, error: r.ok ? null : r.error })
  }
  return out
}

/** Our own copy of the e-Arşiv PDF (the worker saves it; Paraşüt's link expires). 10-minute link. */
export async function invoicePdfUrlAction(input: unknown): Promise<string | null> {
  const p = z.object({ paymentId: z.string().min(1).max(64) }).parse(input)
  const u = await unlocked()
  if (!u.ok) return null
  const file = adminStorage().bucket(storageBucketName()).file(`studios/${u.ctx.studioId}/invoices/${p.paymentId}.pdf`)
  const [exists] = await file.exists()
  if (!exists) return null
  const [url] = await file.getSignedUrl({ action: 'read', expires: systemClock.now() + 10 * 60_000 })
  return url
}

// ── FT-2 · Belge ayarları (owner) ───────────────────────────────────────────────────────────────

export interface InvoiceSettings {
  readonly policy: InvoicePolicy
  readonly connected: boolean
  readonly connectedAt: number | null
}

async function parasutConnected(studioId: string): Promise<boolean> {
  const s = await adminDb().doc(`studios/${studioId}/secrets/parasut`).get()
  return typeof s.get('refreshToken') === 'string'
}

// Ayarlar → Fatura (owner, 2026-11-05). Owner-only, NOT behind the report PIN: nothing here lists a
// customer or a TC kimlik — the PIN guards the list, not the configuration.
async function owner() {
  return { ok: true as const, ctx: await requireTenantContext(OWNER) }
}

export async function loadInvoiceSettingsAction(): Promise<InvoiceSettings | null> {
  const u = await owner()
  const db = adminDb()
  const [policy, secret] = await Promise.all([new FirestoreInvoiceRepository(db).getInvoicePolicy(u.ctx), db.doc(`studios/${u.ctx.studioId}/secrets/parasut`).get()])
  const at = secret.get('connectedAt')
  return { policy, connected: typeof secret.get('refreshToken') === 'string', connectedAt: at instanceof Timestamp ? at.toMillis() : null }
}

export async function saveInvoiceSettingsAction(input: unknown): Promise<Result<void, DomainError>> {
  const p = z
    .object({
      documentByMethod: z.record(z.string(), z.enum(DocumentRules as [DocumentRule, ...DocumentRule[]])),
      serviceLine: z.string().trim().min(1).max(160),
      vatRatePercent: z.number().int().min(0).max(100).nullable(),
      receiptLimitKurus: z.number().int().positive().nullable(),
      internetSaleUrl: z.string().trim().url().max(200).nullable(),
      companyId: z.string().trim().regex(/^\d{1,12}$/).nullable(),
    })
    .parse(input)
  const u = await owner()
  const repo = new FirestoreInvoiceRepository(adminDb())
  const current = await repo.getInvoicePolicy(u.ctx)
  // Parsed back through the same reader the worker uses: what is saved is exactly what will be read.
  const next = parseInvoicePolicy({
    ...current,
    documentByMethod: { ...current.documentByMethod, ...p.documentByMethod },
    serviceLine: p.serviceLine,
    vatRatePercent: p.vatRatePercent,
    receiptLimitKurus: p.receiptLimitKurus,
    internetSaleUrl: p.internetSaleUrl,
    parasut: { ...current.parasut, companyId: p.companyId },
  })
  await repo.saveInvoicePolicy(u.ctx, next)
  return { ok: true, value: undefined }
}

/** Where the Paraşüt function lives. Its URL is also the redirect URI registered with Paraşüt. */
const PARASUT_OAUTH_URL = 'https://europe-west1-studio-yonetim-prod.cloudfunctions.net/parasutOAuth'

/**
 * "Paraşüt'e bağlan": a single-use, 10-minute ticket; the function swaps it for Paraşüt's sign-in
 * page. The owner types his Paraşüt password THERE — it never passes through the panel.
 */
export async function parasutConnectAction(): Promise<string | null> {
  const u = await owner()
  const policy = await new FirestoreInvoiceRepository(adminDb()).getInvoicePolicy(u.ctx)
  const ticket = randomBytes(24).toString('base64url')
  const origin = (await headers()).get('origin') ?? ''
  await adminDb()
    .doc(`studios/${u.ctx.studioId}/secrets/parasutOAuth`)
    .set({
      ticketHash: createHash('sha256').update(ticket).digest('hex'),
      expiresAt: Timestamp.fromMillis(systemClock.now() + 10 * 60_000),
      returnTo: /^https:\/\//.test(origin) ? `${origin}/settings` : null,
      idBase: policy.parasut.idBase,
      by: u.ctx.actor,
    })
  return `${PARASUT_OAUTH_URL}?studio=${encodeURIComponent(String(u.ctx.studioId))}&ticket=${ticket}`
}

export async function revertInvoiceAction(input: unknown): Promise<Result<void, DomainError>> {
  const p = z.object({ paymentId: z.string().min(1), reason: z.string() }).parse(input)
  const u = await unlocked()
  if (!u.ok) return LOCKED
  return revertInvoice(deps(), u.ctx, { paymentId: p.paymentId, reason: p.reason })
}

export async function setNationalIdAction(input: unknown): Promise<Result<void, DomainError>> {
  const p = z.object({ memberId: z.string().min(1), nationalId: z.string().nullable() }).parse(input)
  const u = await unlocked()
  if (!u.ok) return LOCKED
  return setMemberNationalId({ repo: new FirestoreMemberRepository(adminDb()), clock: systemClock }, u.ctx, {
    memberId: p.memberId as MemberId,
    nationalId: p.nationalId,
  })
}
