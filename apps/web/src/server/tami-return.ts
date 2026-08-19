import { FirestorePaymentIntentRepository, type CallbackVerdict, type PaymentIntent, type TenantContext } from '@studio/core'

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

  const { provider, config } = await paymentProviderFor(ctx)
  if (config.provider !== 'tami') {
    // The studio switched providers while this payment was in flight. The intent names the provider
    // it was minted under, so this is a real mismatch rather than a race to paper over.
    console.warn('[tami-return] provider is no longer tami', { sid, orderId, now: config.provider })
    return { ok: false, reason: 'provider_changed', intent }
  }
  if (!provider.configured) return { ok: false, reason: 'not_configured', intent }
  if (!provider.confirm) return { ok: false, reason: 'confirm_unsupported', intent }

  const verification = await provider.confirm(orderId)
  console.log('[tami-return] confirm', { sid, orderId, valid: verification.valid, code: verification.failureCode })

  const verdict: CallbackVerdict = verification.valid
    // Falling back to the intent's own amount is deliberate: the figure was fixed on the server when
    // the checkout was minted (§16), so a query that confirms the order without echoing an amount has
    // still confirmed THAT amount. `money(0)` here would record a paid sale of nothing.
    ? { ok: true, providerRef: orderId, paidAmount: verification.paidAmount ?? intent.amount }
    : { ok: false, providerRef: orderId, reason: verification.failureCode ?? 'tami_not_paid' }

  await completePaidIntent(ctx, intent, verdict)

  if (!verification.valid) return { ok: false, reason: verification.failureCode ?? 'tami_not_paid', intent }
  return { ok: true, intent }
}
