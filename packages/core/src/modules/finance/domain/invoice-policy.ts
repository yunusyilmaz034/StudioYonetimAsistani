import type { PaymentMethod } from './types'

// ── FT-2 · BELGE KURALLARI (owner, 2026-11-04, OR-132) ───────────────────────────────────────────
//
// Which document a payment gets is DATA (`settings/invoicing`), never an `if` on the method:
//   kart/POS → the ÖKC device prints the receipt itself ("otomatik"; the row does not wait)
//   nakit    → the desk ticks "Fiş kesildi", or cuts an e-Arşiv when the customer asks
//   havale / online → e-Arşiv, always by a human's press
// Nothing here ever issues anything. A rule only decides which buttons a row offers and whether the
// row waits in "Kesilmedi". The VAT rate and the service line come from the studio's accountant; until
// the rate is set, e-Arşiv is refused (`invoice_not_configured`) — the system never guesses a tax.

export type DocumentRule = 'okc_auto' | 'okc_manual' | 'e_archive'
export const DocumentRules: readonly DocumentRule[] = ['okc_auto', 'okc_manual', 'e_archive']

export interface InvoicePolicy {
  readonly documentByMethod: Readonly<Record<PaymentMethod, DocumentRule>>
  /** "Pilates hizmeti — {paket}" — `{paket}` becomes the sale lines' description. */
  readonly serviceLine: string
  /** Whole percent (e.g. 20). `null` = not set by the accountant yet: e-Arşiv refused. */
  readonly vatRatePercent: number | null
  /** Above this a receipt is not enough (kuruş). `null` = not set; no warning. */
  readonly receiptLimitKurus: number | null
  /** Shown on an online (PAYTR) sale's e-Arşiv — the law asks for the shop's address. */
  readonly internetSaleUrl: string | null
  readonly parasut: {
    readonly environment: 'staging' | 'production'
    /** Paraşüt's company number. `null` = not connected. */
    readonly companyId: string | null
    /** Staging hosts arrive with the API approval; production uses the documented defaults. */
    readonly apiBase: string | null
    readonly idBase: string | null
  }
}

export const DEFAULT_INVOICE_POLICY: InvoicePolicy = {
  documentByMethod: {
    credit_card: 'okc_auto',
    pos: 'okc_auto',
    cash: 'okc_manual',
    bank_transfer: 'e_archive',
    online: 'e_archive',
    gift_card: 'okc_manual',
    wallet: 'okc_manual',
  },
  serviceLine: 'Pilates hizmeti — {paket}',
  vatRatePercent: null,
  receiptLimitKurus: null,
  internetSaleUrl: null,
  parasut: { environment: 'staging', companyId: null, apiBase: null, idBase: null },
}

/** Read leniently: a missing or unknown value falls back to the default, never throws. */
export function parseInvoicePolicy(raw: unknown): InvoicePolicy {
  const d = (raw ?? {}) as Record<string, unknown>
  const by = (d.documentByMethod ?? {}) as Record<string, unknown>
  const documentByMethod = Object.fromEntries(
    Object.entries(DEFAULT_INVOICE_POLICY.documentByMethod).map(([m, def]) => [
      m,
      DocumentRules.includes(by[m] as DocumentRule) ? (by[m] as DocumentRule) : def,
    ]),
  ) as Record<PaymentMethod, DocumentRule>
  const p = (d.parasut ?? {}) as Record<string, unknown>
  const str = (v: unknown) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null)
  const vat = d.vatRatePercent
  const limit = d.receiptLimitKurus
  return {
    documentByMethod,
    serviceLine: str(d.serviceLine) ?? DEFAULT_INVOICE_POLICY.serviceLine,
    vatRatePercent: typeof vat === 'number' && Number.isInteger(vat) && vat >= 0 && vat <= 100 ? vat : null,
    receiptLimitKurus: typeof limit === 'number' && Number.isInteger(limit) && limit > 0 ? limit : null,
    internetSaleUrl: str(d.internetSaleUrl),
    parasut: {
      environment: p.environment === 'production' ? 'production' : 'staging',
      companyId: str(p.companyId),
      apiBase: str(p.apiBase),
      idBase: str(p.idBase),
    },
  }
}

export function documentRuleFor(policy: InvoicePolicy, method: PaymentMethod): DocumentRule {
  return policy.documentByMethod[method] ?? 'okc_manual'
}

/** The invoice line's text. Empty package names fall back to the template without the slot. */
export function serviceLineFor(policy: InvoicePolicy, packageNames: readonly string[]): string {
  const names = [...new Set(packageNames.map((n) => n.trim()).filter(Boolean))].join(', ')
  const line = names ? policy.serviceLine.replace('{paket}', names) : policy.serviceLine.replace(/\s*[—-]?\s*\{paket\}/, '')
  return line.trim().slice(0, 200) || 'Hizmet bedeli'
}

/**
 * The VAT-exclusive unit price that makes Paraşüt's total land on the gross the human typed. Paraşüt
 * takes a net price and adds VAT; the desk thinks in VAT-included lira. Six decimals so the round trip
 * is exact to the kuruş on OUR arithmetic for every amount a studio sells (tested); whether Paraşüt rounds
 * the same way is the first thing the staging account must show.
 */
export function netUnitPrice(grossKurus: number, vatRatePercent: number): number {
  const net = (grossKurus / 100) * (100 / (100 + vatRatePercent))
  return Math.round(net * 1_000_000) / 1_000_000
}
