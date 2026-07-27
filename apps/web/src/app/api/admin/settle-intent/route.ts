import { NextResponse, type NextRequest } from 'next/server'

import { type StudioId, type TenantContext } from '@studio/core'

import { settleFlaggedIntent } from '@/server/payment-callback'

// BREAK-GLASS — settle a payment the provider took but the system did not grant.
//
// ── Why this exists ─────────────────────────────────────────────────────────────────────────
// An intent sits in `manual_review`: the card was charged and no package exists. It happened for
// real the day self-service checkout shipped — PAYTR adds the bank's instalment commission to the
// amount, the settlement compared for equality, and a paying member got nothing. The rule is fixed,
// but intents flagged BEFORE the fix stay flagged, and there was no way to resolve one anywhere in
// the product.
//
// ── Why it lives here and not in `tools/` ───────────────────────────────────────────────────
// The first attempt was a script. It could mark the intent paid and nothing more: granting the
// package is `completePaidIntent`, which lives in this app, and `tools/` may only reach `core`.
// A script that flips the status without granting is worse than the flag it clears — it removes the
// only signal that anything is wrong. Duplicating the grant into a script would be worse still: two
// copies of the rules that decide what a member owns.
//
// So it runs the SAME function the callback runs, with the same events, and differs in exactly one
// honest way: the operator states what the provider actually took, and the domain decides. An
// underpayment is still refused — this completes what was paid, it does not forgive what was not.
//
// Token-protected rather than session-protected because it is operated from a terminal during an
// incident, the same shape as the WhatsApp resume endpoint. It writes nothing without `apply=1`.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest): Promise<Response> {
  const q = req.nextUrl.searchParams
  const token = q.get('token') ?? ''
  const expected = process.env.WHATSAPP_VERIFY_TOKEN ?? ''
  if (!expected || token !== expected) return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 })

  const studioId = q.get('studio') ?? ''
  const intentId = q.get('intent') ?? ''
  const paid = Number(q.get('paid') ?? '')
  const reason = q.get('reason') ?? ''
  const apply = q.get('apply') === '1'
  if (!studioId || !intentId || !Number.isInteger(paid) || paid <= 0 || reason.trim().length < 8) {
    return NextResponse.json(
      { ok: false, error: 'usage: ?studio=&intent=&paid=<kuruş>&reason=<why>&token=[&apply=1]' },
      { status: 400 },
    )
  }

  const ctx: TenantContext = {
    studioId: studioId as StudioId,
    branchIds: [],
    role: 'owner',
    // The truth about who did this. A break-glass settlement must never be indistinguishable from a
    // callback in the log.
    actor: { type: 'platform_admin', id: 'break_glass' } as TenantContext['actor'],
  }

  const res = await settleFlaggedIntent(ctx, intentId, paid, apply)
  if (!res.found) return NextResponse.json({ ok: false, error: 'intent_not_found' }, { status: 404 })
  return NextResponse.json({ ...res, dryRun: !apply, reason })
}
