import { newCorrelationId, type EventSource, type TenantContext } from '../../../shared'
import { decideExpire, decideFlag } from '../domain/decide'
import type { PaymentsDeps } from './ports'

const SOURCE: EventSource = 'system_reconcile'
const STALE_MS = 60 * 60 * 1000 // 1h — a checkout the member never finished, or a callback that never came

// ── Payment reconciliation (Plus Phase 6, §22). ──────────────────────────────────────────────
//
// It never edits money silently. A checkout the member abandoned times out to `expired`; anything
// stuck mid-flight (processing, a refund the provider has not confirmed) is handed to a HUMAN via
// `manual_review` — because the alternative, guessing, is exactly how a payment gets granted twice or
// a refund gets lost. What it cannot resolve, it flags; what it flags, a person looks at.
export async function reconcilePayments(deps: PaymentsDeps, ctx: TenantContext, nowMs: number): Promise<{ expired: number; flagged: number }> {
  const stale = await deps.repo.listPendingOlderThan(ctx, nowMs - STALE_MS)
  const dctx = {
    studioId: ctx.studioId,
    actor: ctx.actor,
    now: deps.clock.now(),
    correlationId: newCorrelationId(),
    source: SOURCE,
  }
  let expired = 0
  let flagged = 0
  for (const intent of stale) {
    // An awaiting-payment checkout that never completed simply times out.
    if (intent.status === 'awaiting_payment') {
      const r = decideExpire(dctx, intent)
      if (r.ok) {
        await deps.repo.saveIntent(ctx, r.value.next, r.value.events)
        expired++
      }
      continue
    }
    // processing / refund_pending stuck past the window → a human decides (never auto-corrected).
    const flag = decideFlag(dctx, intent, `stuck_${intent.status}`)
    await deps.repo.saveIntent(ctx, flag.next, flag.events)
    flagged++
  }
  return { expired, flagged }
}
