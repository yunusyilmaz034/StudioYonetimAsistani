'use server'

import {
  FirestoreFinanceRepository,
  FirestoreInvoiceRepository,
  FirestoreMemberRepository,
  loadExcludedMemberIds,
  markInvoiceIssued,
  revertInvoice,
  setMemberNationalId,
  systemClock,
  type DomainError,
  type MemberId,
  type Result,
} from '@studio/core'
import { z } from 'zod'

import { requireTenantContext } from '../auth'
import { adminDb } from '../firebase-admin'
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
}

export type InvoiceList =
  | { readonly locked: true; readonly varsayilanPin: boolean }
  | { readonly locked: false; readonly rows: readonly InvoiceRow[]; readonly placeholder: string }

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
  const [marks, memberSnaps] = await Promise.all([
    new FirestoreInvoiceRepository(db).listInvoiceMarks(ctx, live.map((x) => x.id)),
    memberIds.length === 0
      ? Promise.resolve([])
      : db.getAll(...memberIds.map((id) => db.doc(`studios/${ctx.studioId}/members/${id}`))),
  ])
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
      }
    })
  return { locked: false, rows, placeholder: PLACEHOLDER_TC }
}

function deps() {
  const db = adminDb()
  return { repo: new FirestoreFinanceRepository(db), invoices: new FirestoreInvoiceRepository(db), clock: systemClock }
}

export async function markInvoiceIssuedAction(input: unknown): Promise<Result<void, DomainError>> {
  const p = z
    .object({ paymentId: z.string().min(1), note: z.string().max(300).nullable(), invoicedKurus: z.number().int() })
    .parse(input)
  const u = await unlocked()
  if (!u.ok) return LOCKED
  return markInvoiceIssued(deps(), u.ctx, { paymentId: p.paymentId, note: p.note, invoicedKurus: p.invoicedKurus })
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
