import type { Audience, Category, Priority } from './types'

// ── THE RULES TABLE (v1.25, Doc 28 §9). ─────────────────────────────────────────────────────
//
// PURE: (event type) → who should be told, with which template. It is a table, not a switch buried
// in a trigger, because this is the part the owner will want to change — and changing who gets told
// about a cash discrepancy must not mean editing a Cloud Function.
//
// The DOMAIN does not import this. Nothing in `modules/reservations` or `modules/finance` learns
// that notifications exist; the coupling runs one way, downstream of the event.

export interface IntentRule {
  readonly template: string
  readonly to: Audience
  readonly category: Category
  readonly priority: Priority
  // Bulk acts collapse: one intent per (recipient, operationId, template). A closure that cancels
  // twelve of her classes sends ONE message with the count as a parameter — not twelve messages,
  // and not twelve SMS charges (Doc 28 §4).
  readonly collapseByOperation?: boolean
}

export const RULES: Readonly<Record<string, readonly IntentRule[]>> = {
  // ── the member's own reservations ──
  'reservation.booked': [
    { template: 'booking_confirmed', to: 'member', category: 'operational', priority: 'normal', collapseByOperation: true },
  ],
  'reservation.cancelled': [
    { template: 'booking_cancelled', to: 'member', category: 'operational', priority: 'normal', collapseByOperation: true },
  ],
  'reservation.moved': [
    { template: 'booking_moved', to: 'member', category: 'operational', priority: 'high' },
  ],
  'waitlist.promoted': [
    { template: 'waitlist_promoted', to: 'member', category: 'operational', priority: 'high' },
  ],

  // The studio cancelled a class: everyone on the roster is told, and it does not wait for 08:00.
  'class_session.cancelled': [
    { template: 'session_cancelled', to: 'roster', category: 'operational', priority: 'urgent' },
  ],
  // Plus Phase 5 — the class MOVED (time/room changed): the whole roster needs to know the new time.
  'class_session.rescheduled': [
    { template: 'session_rescheduled', to: 'roster', category: 'operational', priority: 'high' },
  ],
  'studio_closure.applied': [
    { template: 'closure_applied', to: 'roster', category: 'operational', priority: 'urgent', collapseByOperation: true },
  ],

  // ── packages & money ──
  'entitlement.purchased': [
    { template: 'package_created', to: 'member', category: 'operational', priority: 'normal' },
  ],
  'entitlement.expiring': [
    { template: 'package_expiring', to: 'member', category: 'operational', priority: 'normal' },
  ],
  'entitlement.credits_low': [
    { template: 'credits_low', to: 'member', category: 'operational', priority: 'low' },
  ],
  'entitlement.exhausted': [
    { template: 'credits_exhausted', to: 'member', category: 'operational', priority: 'normal' },
  ],
  // Plus Phase 5 — the membership's time ran out (distinct from credits running out).
  'entitlement.expired': [
    { template: 'package_expired', to: 'member', category: 'operational', priority: 'normal' },
  ],
  'payment.received': [
    { template: 'payment_received', to: 'member', category: 'operational', priority: 'normal' },
  ],
  'plan.instalment_due': [
    { template: 'instalment_due', to: 'member', category: 'operational', priority: 'normal' },
  ],
  'member.invited': [
    { template: 'portal_invite', to: 'member', category: 'operational', priority: 'high' },
  ],
  'wallet.topup': [
    { template: 'wallet_topup', to: 'member', category: 'operational', priority: 'normal' },
  ],

  // ── STAFF ALERTS. Today nothing tells the owner when an operation fails. That is the most
  //    important line on her list, and it is half of this milestone.
  'drawer.discrepancy_recorded': [
    { template: 'alert_cash_discrepancy', to: 'owner', category: 'operational', priority: 'urgent' },
  ],
  'system.operation_failed': [
    { template: 'alert_operation_failed', to: 'owner', category: 'operational', priority: 'urgent' },
  ],
  'system.error': [
    { template: 'alert_system_error', to: 'owner', category: 'operational', priority: 'urgent' },
  ],
  // A member who was never told her class was cancelled is a phone call RECEPTION must make today.
  'notification.failed': [
    { template: 'alert_delivery_failed', to: 'reception', category: 'operational', priority: 'high' },
  ],
}

export const rulesFor = (eventType: string): readonly IntentRule[] => RULES[eventType] ?? []
