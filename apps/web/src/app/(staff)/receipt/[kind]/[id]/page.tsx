import { notFound } from 'next/navigation'

import { requirePageAccess } from '@/server/auth'
import { RECEIPT_KIND_TR, type ReceiptKind } from '@/lib/receipt'
import { loadReceipt } from '@/server/receipt-query'

import { ReceiptView } from './receipt-view'

// THE RECEIPT — a printable slip, not a fiscal document (owner, 2026-07-13).
//
// A member pays and, until today, gets nothing to hold. This is what reception hands her: what she
// bought, what she paid, what she has left, and until when. Four questions she currently has to take
// somebody's word for.
//
// **It says what it is, in large type, at the bottom: "Bu belge mali belge değildir."** A slip that
// looks like an invoice and is not one is worse than no slip at all — the honesty is the feature.
export default async function ReceiptPage({
  params,
}: {
  params: Promise<{ kind: string; id: string }>
}) {
  const ctx = await requirePageAccess('/receipt')
  const { kind, id } = await params

  if (!(kind in RECEIPT_KIND_TR)) notFound()

  // `issuedAt` is NOW, on purpose: the slip records the moment it was printed, not the moment of the
  // sale — a member who asks for a copy in March should get one dated March, showing her balance in
  // March. The sale's own date is in the log, permanently, and this is not it.
  const data = await loadReceipt(ctx, kind as ReceiptKind, id as never, Date.now())
  if (!data) notFound()

  return <ReceiptView data={data} />
}
