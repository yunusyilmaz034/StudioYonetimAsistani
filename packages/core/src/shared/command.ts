import type { ActorRef } from './actor'
import type { CommandId, StudioId } from './ids'
import type { Instant } from './time'

// A COMMAND is the one thing a client is allowed to write (AD-15, Doc 3 §5): an
// intent it drops into `/commands`, which a trigger later applies. Unlike an event,
// a command is NOT the historical record — it is transient work. It is applied at
// most once, its `status` moves `pending → applied | failed`, and it may be pruned.
// The event(s) the trigger emits are the permanent truth; the command is the
// idempotency key that produced them (its ULID id is that key).
//
// Only OFFLINE-SAFE, IDEMPOTENT writes take this path (AD-35). The whitelist is
// enforced twice: in the security rules (`type in [...]`) and in the trigger's
// dispatch table. Adding a third type is a change to both.
//
// The producer supplies `occurredAt` — the domain instant the thing happened,
// possibly offline and minutes ago. The trigger clamps it (`clampOccurredAt`) and
// stamps it as the emitted event's `occurredAt`; the event's `recordedAt` is the
// server clock at apply time. That two-timestamp split is what makes an offline
// mark honest (non-negotiable #3).

export type CommandStatus = 'pending' | 'applied' | 'failed'

export interface Command<TType extends string = string, TPayload = unknown> {
  readonly id: CommandId
  readonly studioId: StudioId
  readonly type: TType
  readonly actor: ActorRef
  readonly payload: TPayload
  readonly status: CommandStatus
  // Domain time supplied by the client (offline-mintable), always clamped on apply.
  readonly occurredAt: Instant
  // Present only after a failed apply — the domain refusal, for the client to show.
  readonly failedReason?: string
}
