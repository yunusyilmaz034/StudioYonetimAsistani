import {
  FirestorePaymentIntentRepository,
  type CallbackVerdict,
  type Money,
  type PaymentIntent,
  type TenantContext,
} from '@studio/core'

import { completePaidIntent } from './payment-callback'
import { paymentProviderFor } from './payment-provider'
import { adminDb } from './firebase-admin'

// TAMI'DEN DÖNÜŞ — the other half of a provider that does not call us back.
//
// PayTR posts a signed notification to a server endpoint; nothing the buyer does can forge it, and
// the grant hangs off that signature. TAMI does not: it redirects her browser back and says nothing
// to us directly. A redirect is a claim made by whoever is holding the keyboard, so it grants
// nothing here. It only tells us WHEN to ask.
//
// What actually decides is `provider.confirm(orderId)` — a signed query to TAMI about its own
// record. Anything that is not an unambiguous success is treated as not-yet-paid, which is the safe
// way round: a member who paid and is not yet credited phones the studio within the hour, and a
// member credited without paying is a loss nobody ever notices.
//
// Everything after the verdict is the SAME code PayTR completes through (`completePaidIntent`), so
// the package grant, the payment record, the ledger and the invite cannot drift between providers.

/**
 * The whole money decision, as a pure function: given TAMI's answer and the amount we minted, may
 * this intent be marked paid?
 *
 * Extracted so it can be tested without a Firestore, a provider or a tenant. The bug that cost two
 * days on 2026-08-22 was a value silently dropped between layers; the lesson was that a rule which
 * only exists inside an I/O function is a rule nobody tests.
 */
export function tamiVerdict(
  verification: { valid: boolean; paidAmount?: Money | undefined; failureCode?: string | undefined },
  intentAmount: Money,
): CallbackVerdict {
  if (!verification.valid) {
    return { ok: false, providerRef: '', reason: verification.failureCode ?? 'tami_not_paid' }
  }
  const echoed = verification.paidAmount
  // If TAMI echoes an amount, it must be the amount we minted. The figure was fixed on the server
  // (§16) and the hosted page cannot change it, so a disagreement is never a customer paying less —
  // it is an orderId collision, a replayed query, or a bug, and none of those may grant a package.
  // An ABSENT amount is not a disagreement: the query confirmed THIS order, and this order's amount
  // is the one we set. `money(0)` there would record a paid sale of nothing.
  if (echoed != null && echoed.amount !== intentAmount.amount) {
    return { ok: false, providerRef: '', reason: 'tami_amount_mismatch' }
  }
  return { ok: true, providerRef: '', paidAmount: echoed ?? intentAmount }
}

export type TamiReturnOutcome =
  | { readonly ok: true; readonly intent: PaymentIntent }
  | { readonly ok: false; readonly reason: string; readonly intent?: PaymentIntent }

function ctxOf(sid: string): TenantContext {
  return {
    studioId: sid as never,
    branchIds: [],
    role: 'owner',
    // Its own principal, never a borrowed human one (#5). The return is triggered by a member's
    // browser, but the decision to credit is the system's.
    actor: { type: 'system', id: 'tami_return' } as TenantContext['actor'],
  }
}

export async function handleTamiReturn(sid: string, orderId: string): Promise<TamiReturnOutcome> {
  const ctx = ctxOf(sid)
  const repo = new FirestorePaymentIntentRepository(adminDb())

  const intent = await repo.getIntentByProviderRef(ctx, orderId)
  if (!intent) {
    // An unknown order is quarantined rather than guessed at. Reconciliation surfaces it; inventing
    // an intent here would be inventing a sale.
    console.warn('[tami-return] no intent for ref', { sid, orderId })
    return { ok: false, reason: 'unknown_order' }
  }

  // Already settled by an earlier return (she refreshed, or came back twice). Idempotent by the
  // intent's own status — `decideCallbackResult` would refuse anyway, but answering early keeps the
  // log honest about what happened.
  if (intent.status === 'paid') return { ok: true, intent }

  // The INTENT decides, not the studio's current setting. A payment belongs to the provider it was
  // minted under; the studio switching brands mid-flight must not strand the member who is paying
  // right now. It used to refuse here — correct about the mismatch, wrong about whose fact it is.
  if (intent.provider !== 'tami') {
    console.warn('[tami-return] intent is not a tami payment', { sid, orderId, provider: intent.provider })
    return { ok: false, reason: 'provider_mismatch', intent }
  }
  const { provider } = await paymentProviderFor(ctx, 'tami')
  if (!provider.configured) return { ok: false, reason: 'not_configured', intent }
  if (!provider.confirm) return { ok: false, reason: 'confirm_unsupported', intent }

  const verification = await provider.confirm(orderId)
  console.log('[tami-return] confirm', { sid, orderId, valid: verification.valid, code: verification.failureCode })

  const decided = tamiVerdict(verification, intent.amount)
  const verdict: CallbackVerdict = { ...decided, providerRef: orderId }
  if (!decided.ok && decided.reason === 'tami_amount_mismatch') {
    console.error('[tami-return] amount mismatch', {
      sid,
      orderId,
      expectedKurus: intent.amount.amount,
      reportedKurus: verification.paidAmount?.amount,
    })
  }

  await completePaidIntent(ctx, intent, verdict)

  if (!decided.ok) return { ok: false, reason: decided.reason, intent }
  return { ok: true, intent }
}
