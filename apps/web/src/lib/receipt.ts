// THE RECEIPT — the shape, and the words on it.
//
// Client-safe on purpose: the print view is a client component, and importing it from the server
// query would drag `firebase-admin` into the browser bundle. (The build catches it; this file is why
// it does not have to.)

export type ReceiptKind = 'sale' | 'payment' | 'refund' | 'cancellation'

export const RECEIPT_KIND_TR: Record<ReceiptKind, string> = {
  sale: 'Satış',
  payment: 'Tahsilat',
  refund: 'İade',
  cancellation: 'İptal',
}

export interface ReceiptData {
  readonly kind: ReceiptKind
  readonly issuedAt: number

  readonly company: {
    readonly displayName: string
    readonly legalName: string | null
    readonly phone: string | null
    readonly email: string | null
    readonly address: string | null
    readonly website: string | null
  }

  readonly memberName: string

  // The package this receipt is about.
  readonly productName: string
  readonly durationDays: number | null
  readonly validFrom: number
  readonly validUntil: number

  /** null ⇔ an unlimited (period) membership — there is no credit to count. */
  readonly creditsGranted: number | null
  readonly creditsUsed: number | null
  readonly creditsRemaining: number | null

  readonly method: string | null
  readonly paidKurus: number
  readonly priceKurus: number
  readonly balanceKurus: number
  readonly note: string | null
}
