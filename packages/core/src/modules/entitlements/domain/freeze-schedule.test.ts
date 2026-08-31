import { describe, expect, it } from 'vitest'

import { instant, money, type CorrelationId, type EntitlementId, type MemberId, type ProductId, type StudioId } from '../../../shared'
import {
  decideCancelFreezeSchedule,
  decideFreeze,
  decideScheduleFreeze,
  decideStartScheduledFreeze,
  decideUnfreeze,
} from './decide'
import type { Entitlement, FreezeState } from './types'
import scheduledFixture from '../../../../test/golden/entitlement.freeze_scheduled.v1.json'
import cancelledFixture from '../../../../test/golden/entitlement.freeze_schedule_cancelled.v1.json'

// A FREEZE BOOKED FOR LATER (owner, 2026-08-31).
//
// *"Başlangıç ve bitiş tarihi verebilsin, o tarihlerde dondurma işlemi yapabilsin."*
//
// A member says on the 31st of August that she is away from the 5th to the 15th of September. The
// desk could only stop her TODAY, so the only way to honour that was to remember to come back on the
// 5th — which means it did not happen, and she went on paying for days she was told she would not.
//
// What these tests hold down is the part that is easy to get wrong: **a booked freeze is not a
// freeze.** She stays active, she may keep coming to class, no date moves, and the day the clock
// stops is still the day `entitlement.frozen` says it stopped.

const ctx = {
  studioId: 'std_1' as StudioId,
  actor: { type: 'receptionist' as const, id: 'usr_1' as never },
  now: instant(1_768_468_800_000),
  correlationId: 'cor_1' as CorrelationId,
  source: 'reception_web',
}
const systemCtx = { ...ctx, actor: { type: 'system' as const, id: 'freeze_budget_sweep' as never } }

const VALID_UNTIL = instant(1_774_915_200_000) // 2026-04-01
const DAY = 24 * 60 * 60 * 1000

const freeze = (over: Partial<FreezeState> = {}): FreezeState => ({
  entitledDays: 7,
  usedDays: 0,
  periods: [],
  activeFrom: null,
  ...over,
})

const ent = (over: Partial<Entitlement> = {}): Entitlement => ({
  id: 'ent_1' as EntitlementId,
  studioId: 'std_1' as StudioId,
  memberId: 'mem_1' as MemberId,
  productId: 'prd_fitness3' as ProductId,
  productSnapshot: {
    productId: 'prd_fitness3' as ProductId,
    name: 'Fitness 3 Ay',
    category: 'fitness',
    grant: { kind: 'period', durationDays: 90, access: 'unlimited' },
    listPrice: money(300_000),
  },
  policyRef: { policyId: 'prd_fitness3', version: 1 },
  status: 'active',
  validFrom: instant(1_767_225_600_000),
  validUntil: VALID_UNTIL,
  credits: null,
  freeze: freeze(),
  cancellationLedger: { used: 0, refunded: 0 },
  entryLedger: { consumed: 0, restored: 0 },
  priceAgreed: money(300_000),
  paidTotal: money(300_000),
  manualPayment: null,
  purchasedAt: instant(1_767_225_600_000),
  ...over,
})

const TODAY = '2026-08-31'
const PLAN = { from: '2026-09-05', to: '2026-09-12', plannedDays: 7, reason: 'tatil' as const, note: null }

describe('the owner’s example: booked on the 31st, for the 5th to the 12th', () => {
  it('books the window and stops NOTHING — she is still active, and no date moves', () => {
    const r = decideScheduleFreeze(ctx, ent(), TODAY, false, PLAN)
    expect(r.ok).toBe(true)
    if (!r.ok) return

    // The whole point. A booked freeze is not a freeze: every screen that asks "can she book a
    // class this week?" must go on getting the true answer until the day it actually starts.
    expect(r.value.next.status).toBe('active')
    expect(r.value.next.validUntil).toBe(VALID_UNTIL)
    expect(r.value.next.freeze?.scheduledFrom).toBe('2026-09-05')
    expect(r.value.next.freeze?.plannedUntil).toBe('2026-09-12')
    expect(r.value.next.freeze?.grantedDays).toBe(7)
    // Nothing has been spent yet: the budget is charged by the days she actually stood still.
    expect(r.value.next.freeze?.usedDays).toBe(0)
  })

  it('the sweep starts it on the 5th — same event a human produces, different actor', () => {
    const booked = decideScheduleFreeze(ctx, ent(), TODAY, false, PLAN)
    if (!booked.ok) return

    const started = decideStartScheduledFreeze(systemCtx, booked.value.next, '2026-09-05')
    expect(started.ok).toBe(true)
    if (!started.ok) return

    expect(started.value.next.status).toBe('frozen')
    expect(started.value.next.freeze?.activeFrom).toBe('2026-09-05')
    // Cleared, so the same window cannot be started twice.
    expect(started.value.next.freeze?.scheduledFrom).toBeNull()

    const e = started.value.events[0]!
    expect(e.type).toBe('entitlement.frozen')
    expect(e.actor.type).toBe('system')
    // The log must be able to answer "did a person stop her today, or did the plan she agreed to?"
    expect((e.payload as Record<string, unknown>).scheduled).toBe(true)
    // Still no date moved: the extension is paid at unfreeze, for the days it actually stood still.
    expect(started.value.next.validUntil).toBe(VALID_UNTIL)
  })

  it('unfrozen on the 12th → validUntil += 7 days, exactly what was booked', () => {
    const booked = decideScheduleFreeze(ctx, ent(), TODAY, false, PLAN)
    if (!booked.ok) return
    const started = decideStartScheduledFreeze(systemCtx, booked.value.next, '2026-09-05')
    if (!started.ok) return

    const thawed = decideUnfreeze(systemCtx, started.value.next, '2026-09-12', true)
    expect(thawed.ok).toBe(true)
    if (!thawed.ok) return

    expect(thawed.value.next.validUntil).toBe(instant((VALID_UNTIL as number) + 7 * DAY))
    expect(thawed.value.next.status).toBe('active')
    expect(thawed.value.next.freeze?.usedDays).toBe(7)
  })

  it('a sweep that missed a night still starts it on the promised day, not on the day it woke up', () => {
    // The studio owes what it SAID, not what its scheduler managed. Starting from `today` would
    // quietly shorten her freeze by the length of our own outage.
    const booked = decideScheduleFreeze(ctx, ent(), TODAY, false, PLAN)
    if (!booked.ok) return

    const started = decideStartScheduledFreeze(systemCtx, booked.value.next, '2026-09-07') // two days late
    expect(started.ok).toBe(true)
    if (!started.ok) return
    expect(started.value.next.freeze?.activeFrom).toBe('2026-09-05')
  })
})

describe('what a booked freeze REFUSES', () => {
  it('refuses a start date of today — that is a freeze, and it has its own event', () => {
    const r = decideScheduleFreeze(ctx, ent(), TODAY, false, { ...PLAN, from: TODAY, to: '2026-09-05' })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.code).toBe('freeze_start_not_future')
  })

  it('refuses a window that ends before it begins', () => {
    const r = decideScheduleFreeze(ctx, ent(), TODAY, false, { ...PLAN, from: '2026-09-10', to: '2026-09-05' })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.code).toBe('invalid_freeze_days')
  })

  it('refuses a SECOND window while one is already booked', () => {
    const first = decideScheduleFreeze(ctx, ent(), TODAY, false, PLAN)
    if (!first.ok) return
    const second = decideScheduleFreeze(ctx, first.value.next, TODAY, false, { ...PLAN, from: '2026-10-01', to: '2026-10-05' })
    expect(second.ok).toBe(false)
    if (second.ok) return
    // Two windows on one membership cannot both be honoured, and picking one silently would be the
    // system deciding something the desk did not.
    expect(second.error.code).toBe('freeze_already_scheduled')
  })

  it('refuses when a class is already booked INSIDE the window', () => {
    // The same rule an immediate freeze has, and the same reason (owner, 2026-07-13): cancelling
    // her class for her would move a credit she never asked us to move.
    const r = decideScheduleFreeze(ctx, ent(), TODAY, true, PLAN)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.code).toBe('freeze_blocked_by_reservation')
  })

  it('refuses a package sold without a freeze allowance', () => {
    const r = decideScheduleFreeze(ctx, ent({ freeze: null }), TODAY, false, PLAN)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.code).toBe('freeze_not_allowed')
  })
})

describe('going past the allowance — allowed, and no longer silent', () => {
  const LONG = { ...PLAN, from: '2026-09-05', to: '2026-09-15', plannedDays: 10 } // 10 > 7

  it('refuses without the initiative flag — the exception must be an ACT, not a typo', () => {
    const r = decideScheduleFreeze(ctx, ent(), TODAY, false, LONG)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.code).toBe('freeze_days_exceed_budget')
  })

  it('refuses WITH the flag but no reason — the owner asked for the why (2026-08-31)', () => {
    const r = decideScheduleFreeze(ctx, ent(), TODAY, false, { ...LONG, override: true })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.code).toBe('freeze_override_reason_required')
  })

  it('refuses a reason of whitespace — a required field satisfied by a space is not required', () => {
    const r = decideScheduleFreeze(ctx, ent(), TODAY, false, { ...LONG, override: true, overrideReason: '   ' })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.code).toBe('freeze_override_reason_required')
  })

  it('accepts with a reason, records the OVERAGE in the event and the WORDS on state', () => {
    const r = decideScheduleFreeze(ctx, ent(), TODAY, false, {
      ...LONG,
      override: true,
      overrideReason: 'uzun sure yurt disinda',
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return

    const p = r.value.events[0]!.payload as Record<string, unknown>
    // "How often, and for whom, do we go past our own terms?" is a question the owner will ask, and
    // it cannot be answered from a number nobody wrote down.
    expect(p.overageDays).toBe(3) // 10 − 7
    // The WORDS are not in the event. Free text is where PII hides (#6) — and unlike state, an
    // event can never be erased when she asks.
    expect(JSON.stringify(p)).not.toContain('yurt disinda')
    expect(r.value.next.freeze?.overrideReason).toBe('uzun sure yurt disinda')
  })

  it('an immediate freeze demands the same reason — the rule is the domain’s, not the form’s', () => {
    const r = decideFreeze(ctx, ent(), TODAY, false, { plannedDays: 10, reason: 'tatil', note: null, override: true })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.code).toBe('freeze_override_reason_required')
  })
})

describe('she changed her plans', () => {
  it('cancels the booked window; nothing was frozen, so nothing is paid back', () => {
    const booked = decideScheduleFreeze(ctx, ent(), TODAY, false, PLAN)
    if (!booked.ok) return

    const c = decideCancelFreezeSchedule(ctx, booked.value.next, 'uye vazgecti')
    expect(c.ok).toBe(true)
    if (!c.ok) return

    expect(c.value.next.status).toBe('active')
    expect(c.value.next.freeze?.scheduledFrom).toBeNull()
    expect(c.value.next.freeze?.usedDays).toBe(0)
    expect(c.value.next.validUntil).toBe(VALID_UNTIL)
    expect(c.value.events[0]!.type).toBe('entitlement.freeze_schedule_cancelled')
  })

  it('demands a reason — an undo nobody explained is an undo nobody can defend (#9)', () => {
    const booked = decideScheduleFreeze(ctx, ent(), TODAY, false, PLAN)
    if (!booked.ok) return
    const c = decideCancelFreezeSchedule(ctx, booked.value.next, '  ')
    expect(c.ok).toBe(false)
    if (c.ok) return
    expect(c.error.code).toBe('reason_required')
  })

  it('refuses to cancel when nothing is booked', () => {
    const c = decideCancelFreezeSchedule(ctx, ent(), 'neden')
    expect(c.ok).toBe(false)
    if (c.ok) return
    expect(c.error.code).toBe('freeze_not_scheduled')
  })
})

describe('golden payloads — the shape is a contract, and events are permanent', () => {
  it('entitlement.freeze_scheduled', () => {
    const r = decideScheduleFreeze(ctx, ent(), TODAY, false, {
      from: '2026-09-05',
      to: '2026-09-15',
      plannedDays: 10,
      reason: 'tatil',
      note: 'yurt disi',
      override: true,
      overrideReason: 'uzun sure yurt disinda',
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.events[0]!.payload).toEqual(scheduledFixture)
  })

  it('entitlement.freeze_schedule_cancelled', () => {
    const booked = decideScheduleFreeze(ctx, ent(), TODAY, false, { ...PLAN, to: '2026-09-15', override: true, overrideReason: 'x' })
    if (!booked.ok) return
    const c = decideCancelFreezeSchedule(ctx, booked.value.next, 'uye vazgecti')
    expect(c.ok).toBe(true)
    if (!c.ok) return
    expect(c.value.events[0]!.payload).toEqual(cancelledFixture)
  })

  it('neither payload carries the member’s NAME or the free text (#6)', () => {
    const r = decideScheduleFreeze(ctx, ent(), TODAY, false, { ...PLAN, note: 'Ayse hanim ameliyat olacak' })
    if (!r.ok) return
    expect(JSON.stringify(r.value.events[0]!.payload)).not.toContain('Ayse')
    expect(JSON.stringify(r.value.events[0]!.payload)).not.toContain('ameliyat')
  })
})
