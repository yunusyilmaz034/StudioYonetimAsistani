// FT-2 · Paraşüt API v4 — the PURE half: request bodies and response readers. No network, no clock.
//
// Shapes are from Paraşüt's own OpenAPI document (devhub.parasut.com/openapi.json, read 2026-11-05).
// JSON:API: `application/vnd.api+json`, `{ data: { type, attributes, relationships } }`.
//
// The one property this integration rests on: a sales invoice carries an `external_reference_key`
// (UUID). A second create with the same key is refused (422, `meta.sales_invoice_id` = the existing
// one) and `GET sales_invoices/find_by_external_reference_key` finds it. Our `requestId` IS that key,
// so whatever a crashed attempt got as far as creating is found, never made twice.

export const PARASUT_PROD = {
  apiBase: 'https://api.parasut.com/v4',
  idBase: 'https://id.parasut.com/realms/parasut/protocol/openid-connect',
} as const

/** The 11 ones the e-Arşiv portal takes for a buyer who gave no TC kimlik (nihai tüketici). */
export const UNKNOWN_TC = '11111111111'

export interface Buyer {
  readonly name: string
  /** A real TC kimlik, or null → UNKNOWN_TC on the invoice and an unlisted contact. */
  readonly nationalId: string | null
  readonly city: string | null
  readonly district: string | null
}

export interface InvoiceInput {
  readonly requestId: string
  readonly issueDate: string // YYYY-MM-DD, Istanbul
  readonly serviceLine: string
  readonly netUnitPrice: number
  readonly vatRatePercent: number
  /** Our own reference on the invoice — the payment id. Not PII. */
  readonly description: string
  readonly city: string | null
  readonly district: string | null
}

export function contactBody(b: Buyer) {
  return {
    data: {
      type: 'contacts',
      attributes: {
        name: b.name.trim().slice(0, 120),
        contact_type: 'person',
        account_type: 'customer',
        tax_number: b.nationalId ?? UNKNOWN_TC,
        // A buyer without a TC is a one-off retail customer: unlisted, so Paraşüt's customer list does
        // not fill with a hundred "Ayşe"s. A buyer WITH a TC is found again by it next time.
        untrackable: b.nationalId === null,
        ...(b.city ? { city: b.city } : {}),
        ...(b.district ? { district: b.district } : {}),
      },
    },
  }
}

export function salesInvoiceBody(i: InvoiceInput, contactId: string) {
  return {
    data: {
      type: 'sales_invoices',
      attributes: {
        item_type: 'invoice',
        description: i.description,
        issue_date: i.issueDate,
        due_date: i.issueDate,
        currency: 'TRL',
        ...(i.city ? { city: i.city } : {}),
        ...(i.district ? { district: i.district } : {}),
      },
      relationships: {
        contact: { data: { id: contactId, type: 'contacts' } },
        details: {
          data: [
            {
              type: 'sales_invoice_details',
              attributes: { quantity: 1, unit_price: i.netUnitPrice, vat_rate: i.vatRatePercent, description: i.serviceLine },
            },
          ],
        },
        external_reference_key: { data: { type: 'external_reference_keys', attributes: { key: i.requestId } } },
      },
    },
  }
}

export interface InternetSale {
  readonly url: string
  readonly paymentDate: string
}

export function eArchiveBody(salesInvoiceId: string, internetSale: InternetSale | null) {
  return {
    data: {
      type: 'e_archives',
      attributes: internetSale
        ? {
            internet_sale: {
              url: internetSale.url,
              payment_type: 'ODEMEARACISI',
              payment_platform: 'PayTR',
              payment_date: internetSale.paymentDate,
            },
          }
        : {},
      relationships: { sales_invoice: { data: { id: salesInvoiceId, type: 'sales_invoices' } } },
    },
  }
}

// ── readers ────────────────────────────────────────────────────────────────────────────────────

type Json = Record<string, unknown>
const obj = (v: unknown): Json => (v && typeof v === 'object' ? (v as Json) : {})

export function dataId(body: unknown): string | null {
  const id = obj(obj(body).data).id
  return typeof id === 'string' || typeof id === 'number' ? String(id) : null
}

/** The sales invoice's active e-document (an e-Arşiv once cut), from `?include=active_e_document`. */
export function activeEDocument(body: unknown): { id: string; type: string; invoiceNumber: string | null } | null {
  const rel = obj(obj(obj(obj(body).data).relationships).active_e_document).data
  const ref = obj(rel)
  if (typeof ref.id !== 'string' && typeof ref.id !== 'number') return null
  const included = Array.isArray(obj(body).included) ? (obj(body).included as unknown[]) : []
  const doc = included.map(obj).find((x) => String(x.id) === String(ref.id) && x.type === ref.type)
  const no = obj(doc?.attributes).invoice_number
  return { id: String(ref.id), type: String(ref.type), invoiceNumber: typeof no === 'string' ? no : null }
}

export function jobStatus(body: unknown): { status: 'running' | 'done' | 'error'; errors: string[] } {
  const a = obj(obj(obj(body).data).attributes)
  const status = a.status === 'done' || a.status === 'error' ? a.status : 'running'
  const errors = Array.isArray(a.errors) ? a.errors.map((e) => (typeof e === 'string' ? e : JSON.stringify(e))) : []
  return { status, errors }
}

/** `{ errors: [{ title, detail, meta }] }` → one readable sentence, and the existing invoice on a key repeat. */
export function readError(body: unknown): { message: string; existingSalesInvoiceId: string | null } {
  const errors = Array.isArray(obj(body).errors) ? (obj(body).errors as unknown[]).map(obj) : []
  const message = errors.map((e) => String(e.detail ?? e.title ?? '')).filter(Boolean).join(' · ') || 'Paraşüt isteği reddetti.'
  const existing = errors.map((e) => obj(e.meta).sales_invoice_id).find((v) => typeof v === 'string' || typeof v === 'number')
  return { message: message.slice(0, 300), existingSalesInvoiceId: existing === undefined ? null : String(existing) }
}

/** `YYYY-MM-DD` in Istanbul for an instant. */
export function istanbulDate(ms: number): string {
  return new Date(ms + 3 * 3_600_000).toISOString().slice(0, 10)
}
