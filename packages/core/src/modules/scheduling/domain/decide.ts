import {
  err,
  localDateAt,
  ok,
  type ActorRef,
  type AggregateKind,
  type BranchId,
  type CorrelationId,
  type DomainError,
  type EventRelated,
  type EventSource,
  type Instant,
  type MemberId,
  type NewEvent,
  type Result,
  type StaffUserId,
  type StudioId,
} from '../../../shared'
import {
  CLASS_SESSION_ASSIGNED,
  CLASS_SESSION_CANCELLED,
  CLASS_SESSION_CAPACITY_CHANGED,
  CLASS_SESSION_NOTE_SET,
  CLASS_SESSION_ROOM_CHANGED,
  CLASS_SESSION_SEAT_HELD,
  CLASS_SESSION_SEAT_RELEASED,
  CLASS_SESSION_GUEST_ARRIVED,
  CLASS_SESSION_SCHEDULED,
  CLASS_SESSION_SCHEDULED_VERSION,
  STUDIO_SETTINGS_UPDATED,
  CLASS_SESSION_RESCHEDULED,
  CLASS_SESSION_TRAINER_CHANGED,
  CLASS_TEMPLATE_CREATED,
  CLASS_TEMPLATE_DEACTIVATED,
  CLASS_TEMPLATE_UPDATED,
  ROOM_CREATED,
  ROOM_DEACTIVATED,
  ROOM_REACTIVATED,
  ROOM_UPDATED,
  SERVICE_CREATED,
  SERVICE_DEACTIVATED,
  SERVICE_POLICY_PUBLISHED,
  SERVICE_REACTIVATED,
  SERVICE_UPDATED,
} from '../events'
import { defaultAdmission } from './types'
import type {
  ClassSession,
  ClassTemplate,
  NoteVisibility,
  Room,
  SeatHold,
  Service,
  StudioSettings,
} from './types'
import { occupiedSeats } from './types'
import { checkWorkingHours, type StudioHours } from './working-hours'

export interface DecideContext {
  readonly studioId: StudioId
  readonly actor: ActorRef
  readonly now: Instant
  readonly correlationId: CorrelationId
  readonly source: EventSource
}

function base(
  ctx: DecideContext,
  kind: AggregateKind,
  id: string,
  branchId: BranchId | null,
  related: EventRelated = {},
) {
  return {
    studioId: ctx.studioId,
    branchId,
    version: 1,
    occurredAt: ctx.now,
    actor: ctx.actor,
    source: ctx.source,
    subject: { kind, id },
    related,
    policyRef: null,
    commandId: null,
    causationId: null,
    correlationId: ctx.correlationId,
  }
}

// Düet (owner, 2026-09-16) — a private session's head count is the OWNER's call: 1 is one-on-one,
// 2 is a düet, more is whatever she sells. The old two-person ceiling is deliberately gone. The
// only rule left is arithmetic: a session may never name more members than it has seats.
function assignmentFits_(assigned: readonly unknown[], capacity: number): Result<never, DomainError> | null {
  return assigned.length > capacity
    ? err({ code: 'assignment_exceeds_capacity', assignedCount: assigned.length, capacity })
    : null
}

function reason_(reason: string): Result<never, DomainError> | null {
  return reason.trim().length === 0 ? err({ code: 'reason_required' }) : null
}

// A binding business rule (v1.12): a session that has STARTED or is no longer
// `scheduled` may never be edited — trainer, room, and capacity changes apply only to
// not-yet-started future sessions. This keeps the event history, attendance, and
// (later) financial records consistent with what the session actually was. Pure: the
// clock is `ctx.now`, injected. Cancellation is a separate act, not an edit.
function editable_(ctx: DecideContext, session: ClassSession): Result<never, DomainError> | null {
  return session.status !== 'scheduled' || session.startsAt <= ctx.now
    ? err({ code: 'session_not_editable' })
    : null
}

// ── Service ──
export function decideCreateService(ctx: DecideContext, s: Service): NewEvent[] {
  return [
    {
      ...base(ctx, 'service', s.id, null),
      type: SERVICE_CREATED,
      payload: { name: s.name, category: s.category, policyVersion: s.policyVersion },
    },
  ]
}

export function decideUpdateService(ctx: DecideContext, current: Service, next: Service): NewEvent[] {
  const changedFields = current.name !== next.name ? ['name'] : []
  if (changedFields.length === 0) return []
  return [{ ...base(ctx, 'service', next.id, null), type: SERVICE_UPDATED, payload: { changedFields } }]
}

export function decidePublishServicePolicy(
  ctx: DecideContext,
  next: Service,
  changedFields: readonly string[],
): NewEvent[] {
  return [
    {
      ...base(ctx, 'service', next.id, null),
      type: SERVICE_POLICY_PUBLISHED,
      payload: { policyVersion: next.policyVersion, changedFields },
    },
  ]
}

export function decideDeactivateService(
  ctx: DecideContext,
  s: Service,
  reason: string,
): Result<NewEvent[], DomainError> {
  const bad = reason_(reason)
  if (bad) return bad
  return ok([{ ...base(ctx, 'service', s.id, null), type: SERVICE_DEACTIVATED, payload: { reason } }])
}

export function decideReactivateService(ctx: DecideContext, s: Service): NewEvent[] {
  return [{ ...base(ctx, 'service', s.id, null), type: SERVICE_REACTIVATED, payload: {} }]
}

// ── Room ──
export function decideCreateRoom(ctx: DecideContext, r: Room): NewEvent[] {
  return [
    {
      ...base(ctx, 'room', r.id, r.branchId),
      type: ROOM_CREATED,
      payload: { branchId: r.branchId, name: r.name, capacity: r.capacity },
    },
  ]
}

export function decideUpdateRoom(ctx: DecideContext, current: Room, next: Room): NewEvent[] {
  const changedFields: string[] = []
  if (current.name !== next.name) changedFields.push('name')
  if (current.capacity !== next.capacity) changedFields.push('capacity')
  if (changedFields.length === 0) return []
  return [{ ...base(ctx, 'room', next.id, next.branchId), type: ROOM_UPDATED, payload: { changedFields } }]
}

export function decideDeactivateRoom(
  ctx: DecideContext,
  r: Room,
  reason: string,
): Result<NewEvent[], DomainError> {
  const bad = reason_(reason)
  if (bad) return bad
  return ok([{ ...base(ctx, 'room', r.id, r.branchId), type: ROOM_DEACTIVATED, payload: { reason } }])
}

export function decideReactivateRoom(ctx: DecideContext, r: Room): NewEvent[] {
  return [{ ...base(ctx, 'room', r.id, r.branchId), type: ROOM_REACTIVATED, payload: {} }]
}

// ── ClassTemplate ──
export function decideCreateTemplate(ctx: DecideContext, t: ClassTemplate): NewEvent[] {
  return [
    {
      ...base(ctx, 'classTemplate', t.id, t.branchId, t.trainerId ? { trainerId: t.trainerId } : {}),
      type: CLASS_TEMPLATE_CREATED,
      payload: {
        serviceId: t.serviceId,
        branchId: t.branchId,
        roomId: t.roomId,
        trainerId: t.trainerId,
        dayOfWeek: t.dayOfWeek,
        startTime: t.startTime,
        durationMinutes: t.durationMinutes,
        capacity: t.capacity,
        validFrom: t.validFrom,
        validUntil: t.validUntil,
      },
    },
  ]
}

export function decideDeactivateTemplate(
  ctx: DecideContext,
  t: ClassTemplate,
  reason: string,
): Result<NewEvent[], DomainError> {
  const bad = reason_(reason)
  if (bad) return bad
  return ok([
    { ...base(ctx, 'classTemplate', t.id, t.branchId), type: CLASS_TEMPLATE_DEACTIVATED, payload: { reason } },
  ])
}

// Edit a template in place (AD-49 pattern). Only FUTURE generations change —
// already-generated sessions keep their snapshot (idempotent generation, AD-50).
// serviceId and branchId are not editable (a different service means a different
// template; create a new one). No "started" guard: a template is a recurring
// definition, not a dated session.
export function decideUpdateTemplate(
  ctx: DecideContext,
  current: ClassTemplate,
  next: ClassTemplate,
  reason: string,
): Result<NewEvent[], DomainError> {
  const bad = reason_(reason)
  if (bad) return bad
  const changedFields: string[] = []
  if (current.roomId !== next.roomId) changedFields.push('roomId')
  if (current.trainerId !== next.trainerId) changedFields.push('trainerId')
  if (current.dayOfWeek !== next.dayOfWeek) changedFields.push('dayOfWeek')
  if (current.startTime !== next.startTime) changedFields.push('startTime')
  if (current.durationMinutes !== next.durationMinutes) changedFields.push('durationMinutes')
  if (current.capacity !== next.capacity) changedFields.push('capacity')
  if (current.validFrom !== next.validFrom) changedFields.push('validFrom')
  if (current.validUntil !== next.validUntil) changedFields.push('validUntil')
  if (changedFields.length === 0) return ok([]) // no-op
  return ok([
    {
      ...base(ctx, 'classTemplate', next.id, next.branchId, next.trainerId ? { trainerId: next.trainerId } : {}),
      type: CLASS_TEMPLATE_UPDATED,
      payload: { changedFields, reason },
    },
  ])
}

// ── ClassSession ──
export function decideScheduleSession(
  ctx: DecideContext,
  session: ClassSession,
  room: Room | null,
  // AG-1 — the studio's opening hours AND the calendar's exceptions, in one object. REQUIRED: an
  // optional guard is a guard that is one refactor away from being forgotten, and this one was already
  // forgotten once (stored from S2, enforced nowhere).
  studio: StudioHours,
): Result<NewEvent[], DomainError> {
  if (session.endsAt <= session.startsAt) return err({ code: 'invalid_time_range' })

  // The studio cannot hold a class at a time it is not open — UNLESS the calendar says this exact date
  // is a `special_working_day`, which is the studio saying, in writing, "we are open". The calendar is
  // the more specific statement, and the more specific statement wins (D23).
  const hours = checkWorkingHours(studio, session.startsAt, session.endsAt)
  if (!hours.ok) {
    return hours.reason === 'closed_day'
      ? err({ code: 'studio_closed_on_day' })
      : err({ code: 'outside_working_hours', open: hours.hours!.open, close: hours.hours!.close })
  }

  if (room) {
    if (room.branchId !== session.branchId) return err({ code: 'branch_mismatch' })
    if (session.capacity > room.capacity) {
      return err({
        code: 'session_capacity_exceeds_room',
        capacity: session.capacity,
        roomCapacity: room.capacity,
      })
    }
  }
  // D13 — a member may only be assigned to a PRIVATE session. Assigning one to a group class
  // would mean "this Reformer class belongs to Elif", which is not a thing.
  if (session.assignedMemberIds.length > 0 && session.category !== 'private') {
    return err({ code: 'assignment_requires_private_session' })
  }
  const tooMany = assignmentFits_(session.assignedMemberIds, session.capacity)
  if (tooMany) return tooMany
  // The event's `related.memberId` is a single field, so it is only meaningful when the session
  // belongs to exactly one person. A düet relates to nobody in particular — the payload carries
  // both names, and that is where the truth lives.
  const soleAssignee = session.assignedMemberIds.length === 1 ? session.assignedMemberIds[0] : undefined
  return ok([
    {
      ...base(ctx, 'classSession', session.id, session.branchId, {
        classSessionId: session.id,
        ...(session.trainerId ? { trainerId: session.trainerId } : {}),
        ...(soleAssignee ? { memberId: soleAssignee } : {}),
      }),
      type: CLASS_SESSION_SCHEDULED,
      version: CLASS_SESSION_SCHEDULED_VERSION, // v6 — carries assignedMemberIds (düet)
      payload: {
        serviceId: session.serviceId,
        branchId: session.branchId,
        roomId: session.roomId,
        trainerId: session.trainerId,
        assignedMemberIds: session.assignedMemberIds,
        category: session.category,
        startsAt: session.startsAt,
        endsAt: session.endsAt,
        capacity: session.capacity,
        policyVersion: session.policyRef.version,
        // D14 — the window this session is created under, and which level of the chain
        // answered. Recorded on the event so the log can explain itself later.
        cancellationWindowHours: session.policySnapshot.cancellationWindowHours,
        cancellationWindowSource: session.policySnapshot.cancellationWindowSource,
        // v4 — stated even when the session declares nothing, so a reader never has to know which
        // rule was in force the day the row was written. `defaultAdmission` is what "nothing" means.
        admission: session.admission ?? defaultAdmission(session.category),
        contentLabel: session.contentLabel ?? null,
      },
    },
  ])
}

// ── STUDIO SETTINGS (v1.27 S2 · owner, 2026-07-13) ───────────────────────────────────────────
//
// One event, and TWO CLASSES OF FIELD inside it — and the split is the whole design:
//
//   • **Settings that change a DOMAIN DECISION** (the cancellation window, the low-credit
//     threshold, the discount ceiling, the default duration) are logged with their **previous AND
//     new values**. A member who booked under a six-hour window and was later judged under a
//     twelve-hour one deserves an answer, and "we changed it at some point" is not one. *A rule
//     that cannot be reconstructed cannot be defended.*
//
//   • **Configuration** (the company's address, its tax number, its phone, the working hours, the
//     QR TTL) is logged as **field names only**. A tax number and an address are business PII, and
//     the log is permanent — the same discipline as `member.profile_updated` (AD-25): the audit
//     answers *which fields changed, when, and by whom*, never *to what*.
//
// Changing a setting reaches nothing that already happened: every session carries its own resolved,
// stamped window (D14), and no field here rewrites one.
const RULE_FIELDS = [
  'defaultCancellationWindowHours',
  'lowCreditThreshold',
  'discountCeilingPercent',
  'defaultSessionDurationMinutes',
] as const

export function decideUpdateStudioSettings(
  ctx: DecideContext,
  current: StudioSettings | null,
  next: StudioSettings,
): Result<NewEvent[], DomainError> {
  if (next.defaultCancellationWindowHours !== null && next.defaultCancellationWindowHours < 0) {
    return err({ code: 'invalid_time_range' })
  }
  if (next.defaultSessionDurationMinutes !== null && next.defaultSessionDurationMinutes <= 0) {
    return err({ code: 'invalid_time_range' })
  }
  if (next.qr && (next.qr.tokenTtlSeconds <= 0 || next.qr.checkInWindowMinutes < 0)) {
    return err({ code: 'invalid_time_range' })
  }
  for (const day of Object.values(next.workingHours ?? {})) {
    // A day that closes before it opens is not a short day; it is a typo that would silently make
    // every hour of it invalid.
    if (day && day.close <= day.open) return err({ code: 'invalid_time_range' })
  }

  const changedFields: string[] = []
  const values: Record<string, unknown> = {}

  for (const field of RULE_FIELDS) {
    const before = current?.[field] ?? null
    const after = next[field] ?? null
    if (before === after) continue
    changedFields.push(field)
    // The value AND the value it replaced. This is the half of the log that has to survive a
    // dispute, and it is why these four are not in the `changedFields`-only bucket.
    values[field] = after
    values[`previous${field.charAt(0).toUpperCase()}${field.slice(1)}`] = before
  }

  // Configuration: the NAME of what changed, and nothing else. Never the address, never the tax
  // number, never the phone — the log is permanent and none of them belong in it (#6).
  const config: { readonly key: string; readonly a: unknown; readonly b: unknown }[] = [
    { key: 'timeZone', a: current?.timeZone ?? null, b: next.timeZone },
    { key: 'company', a: current?.company ?? null, b: next.company },
    { key: 'workingHours', a: current?.workingHours ?? null, b: next.workingHours },
    { key: 'qr', a: current?.qr ?? null, b: next.qr },
    { key: 'notifications', a: current?.notifications ?? null, b: next.notifications },
    // Plus Phase 8 / pilot — the occupancy config and the KK/havale surcharge are settings too. Without
    // them here, changing ONLY one of them produced zero changed fields → the save silently no-op'd
    // (updateStudioSettings returns ok without writing). That is exactly why the seeded surcharge never
    // persisted and why editing only these in the form did nothing.
    { key: 'fitness', a: current?.fitness ?? null, b: next.fitness },
    { key: 'paymentSurcharge', a: current?.paymentSurcharge ?? null, b: next.paymentSurcharge },
  ]
  for (const { key, a, b } of config) {
    if (JSON.stringify(a) !== JSON.stringify(b)) changedFields.push(key)
  }

  if (changedFields.length === 0) return ok([]) // idempotent: saving an unchanged form is not an act

  return ok([
    {
      ...base(ctx, 'policy', ctx.studioId, null, {}),
      type: STUDIO_SETTINGS_UPDATED,
      payload: { changedFields, ...values },
    },
  ])
}

// D13 — reserve a private session for one or more members, change who they are, or release it
// back to studio inventory (an empty list).
//
// ADDING a name while someone is booked is allowed, and it has to be: that is exactly how a düet
// fills — the first person books, then the second name is added. REMOVING one is not, because the
// booked member may be the very name being removed, and her reservation would outlive her claim
// to the seat. Cancel the reservation first: an explicit act, with its own event and credit effect.
export function decideAssignSessionMember(
  ctx: DecideContext,
  session: ClassSession,
  to: readonly MemberId[],
): Result<NewEvent[], DomainError> {
  if (session.category !== 'private') return err({ code: 'assignment_requires_private_session' })
  if (session.status !== 'scheduled' || session.startsAt <= ctx.now) {
    return err({ code: 'session_not_editable' })
  }
  const from = session.assignedMemberIds
  const same = from.length === to.length && from.every((id) => to.includes(id))
  if (same) return ok([]) // idempotent
  const tooMany = assignmentFits_(to, session.capacity)
  if (tooMany) return tooMany
  const removed = from.filter((id) => !to.includes(id))
  if (removed.length > 0 && session.bookedCount > 0) return err({ code: 'session_has_reservations' })
  const sole = to.length === 1 ? to[0] : undefined
  return ok([
    {
      ...base(ctx, 'classSession', session.id, session.branchId, {
        classSessionId: session.id,
        ...(sole ? { memberId: sole } : {}),
      }),
      type: CLASS_SESSION_ASSIGNED,
      payload: { from, to },
    },
  ])
}

export function decideCancelSession(
  ctx: DecideContext,
  session: ClassSession,
  reason: string,
): Result<NewEvent[], DomainError> {
  const bad = reason_(reason)
  if (bad) return bad
  if (session.status === 'cancelled') return ok([]) // idempotent
  return ok([
    {
      ...base(ctx, 'classSession', session.id, session.branchId, { classSessionId: session.id }),
      type: CLASS_SESSION_CANCELLED,
      payload: { reason, startsAt: session.startsAt },
    },
  ])
}

// Move the session to a new time (Plus Phase 2 — Edit Experience). The same guards as creation apply
// to the NEW time: the session must not have started, the range must be valid, and the studio must be
// open then (AG-1 — unless the calendar marks it a special working day). A no-op (same time) writes
// nothing. Category, service and bookings are untouched — this only moves the clock.
export function decideReschedule(
  ctx: DecideContext,
  session: ClassSession,
  toStartsAt: Instant,
  toEndsAt: Instant,
  studio: StudioHours,
  reason: string,
): Result<NewEvent[], DomainError> {
  const started = editable_(ctx, session)
  if (started) return started
  const bad = reason_(reason)
  if (bad) return bad
  if (toEndsAt <= toStartsAt) return err({ code: 'invalid_time_range' })
  const hours = checkWorkingHours(studio, toStartsAt, toEndsAt)
  if (!hours.ok) {
    return hours.reason === 'closed_day'
      ? err({ code: 'studio_closed_on_day' })
      : err({ code: 'outside_working_hours', open: hours.hours!.open, close: hours.hours!.close })
  }
  if (toStartsAt === session.startsAt && toEndsAt === session.endsAt) return ok([])
  return ok([
    {
      ...base(ctx, 'classSession', session.id, session.branchId, { classSessionId: session.id }),
      type: CLASS_SESSION_RESCHEDULED,
      payload: {
        fromStartsAt: session.startsAt,
        toStartsAt,
        fromEndsAt: session.endsAt,
        toEndsAt,
        reason,
      },
    },
  ])
}

export function decideChangeTrainer(
  ctx: DecideContext,
  session: ClassSession,
  to: StaffUserId | null,
  reason: string,
): Result<NewEvent[], DomainError> {
  const started = editable_(ctx, session)
  if (started) return started
  const bad = reason_(reason)
  if (bad) return bad
  return ok([
    {
      ...base(ctx, 'classSession', session.id, session.branchId, {
        classSessionId: session.id,
        ...(to ? { trainerId: to } : {}),
      }),
      type: CLASS_SESSION_TRAINER_CHANGED,
      payload: { from: session.trainerId, to, reason },
    },
  ])
}

// Change the session's room. AD-48: a room is branch-scoped and a session's capacity
// may not exceed its room's capacity. Clearing the room (to null) drops those checks.
export function decideChangeRoom(
  ctx: DecideContext,
  session: ClassSession,
  toRoom: Room | null,
  reason: string,
): Result<NewEvent[], DomainError> {
  const started = editable_(ctx, session)
  if (started) return started
  const bad = reason_(reason)
  if (bad) return bad
  if (toRoom) {
    if (!toRoom.active) return err({ code: 'room_not_active' })
    if (toRoom.branchId !== session.branchId) return err({ code: 'branch_mismatch' })
    if (session.capacity > toRoom.capacity) {
      return err({
        code: 'session_capacity_exceeds_room',
        capacity: session.capacity,
        roomCapacity: toRoom.capacity,
      })
    }
  }
  return ok([
    {
      ...base(ctx, 'classSession', session.id, session.branchId, { classSessionId: session.id }),
      type: CLASS_SESSION_ROOM_CHANGED,
      payload: { fromRoomId: session.roomId, toRoomId: toRoom ? toRoom.id : null, reason },
    },
  ])
}

// Change the session's capacity. It may never drop below what is already booked (a
// booked member is never stranded), and may not exceed the room (AD-48).
export function decideChangeCapacity(
  ctx: DecideContext,
  session: ClassSession,
  toCapacity: number,
  reason: string,
): Result<NewEvent[], DomainError> {
  // ── KONTENJAN ADMİNİNDİR (owner, 2026-09-22) ─────────────────────────────────────────────
  //
  // *"Kontenjanı elle yükseltebilelim, değiştirebilelim. Stüdyonun kapasitesi seni ilgilendirmez,
  // default neyse o kalsın ama admin değiştirmek isterse yapsın, itiraz etmesin."*
  //
  // İki itiraz kalkıyor:
  //
  //   • **Ders başlamış olması.** Diğer düzenlemeler (eğitmen, salon, saat) için "başlamış ders
  //     düzenlenmez" doğrudur — olmuş bir şeyi değiştirmek olur. Kontenjan öyle değil: masaya gelen
  //     dokuzuncu kişi zaten DERS BİTTİKTEN sonra ekleniyor ("Sonradan üye ekle"), ve kontenjan
  //     kapalıysa o kişi sisteme hiç giremiyor. İptal edilmiş seans hâlâ dışarıda: iptal edilmiş
  //     bir dersin kontenjanı yoktur.
  //   • **Oda kapasitesi tavanı.** Odanın kaç makinesi olduğunu stüdyo bilir, sistem değil; bir
  //     gün bir makine daha koyarlar, bir gün iki kişi aynı aleti paylaşır. Varsayılan hâlâ odanın
  //     kapasitesi — seans o sayıyla kurulur; ama admin başka bir sayı yazmak istediğinde sistem
  //     onun yerine karar vermez.
  //
  // KALAN İKİ SINIR ITIRAZ DEĞİL, TUTARLILIK: kontenjan ne mevcut rezervasyon sayısının, ne de yeri
  // söz verilmiş isimlerin altına düşebilir. Orada "hayır" demek bir tercih değil, veriyi bozmamak.
  if (session.status !== 'scheduled') return err({ code: 'session_not_editable' })
  const bad = reason_(reason)
  if (bad) return bad
  const tooMany = assignmentFits_(session.assignedMemberIds, toCapacity)
  if (tooMany) return tooMany
  if (toCapacity < session.bookedCount) {
    return err({ code: 'capacity_below_booked', bookedCount: session.bookedCount })
  }
  if (toCapacity === session.capacity) return ok([]) // no-op
  return ok([
    {
      ...base(ctx, 'classSession', session.id, session.branchId, { classSessionId: session.id }),
      type: CLASS_SESSION_CAPACITY_CHANGED,
      payload: { fromCapacity: session.capacity, toCapacity, reason },
    },
  ])
}

// Set (or clear) the class note (Ders Notu). Free text is preserved intact — trimmed
// only at the edges. Unlike trainer/room/capacity edits, a note is metadata, not a
// schedule change, so it is allowed on any non-cancelled session (you may note a class
// that has already happened). Empty text clears the note. No `reason` required.
export function decideSetSessionNote(
  ctx: DecideContext,
  session: ClassSession,
  input: { text: string; visibility: NoteVisibility },
): Result<NewEvent[], DomainError> {
  if (session.status === 'cancelled') return err({ code: 'session_not_editable' })
  return ok([
    {
      ...base(ctx, 'classSession', session.id, session.branchId, { classSessionId: session.id }),
      type: CLASS_SESSION_NOTE_SET,
      payload: { text: input.text.trim(), visibility: input.visibility },
    },
  ])
}

// ── Holding a seat for a non-member (owner, 2026-07-27) ──────────────────────────────────────
//
// "Multisport üyeleri bize WhatsApp'tan yazıyor, biz onlara yer ayırıyoruz." Until now the system
// had no way to say that, so the seat stayed free in every screen and could be given away twice.
//
// The rules are the ones a booking already obeys, minus everything about credit:
//   • the class must still be open — a cancelled class has no seats to give
//   • it must not be full, counting HELD seats as taken (`occupiedSeats`). Refused, never
//     over-allocated: a seat promised twice is worse than a seat not promised
//   • the note is mandatory and non-empty, because "kime ayırdın" is the entire point — an
//     anonymous hold is a seat that silently disappears and nobody can explain
export interface SeatHoldOutcome {
  readonly hold: SeatHold
  readonly session: ClassSession
  readonly events: readonly NewEvent[]
}

export function decideHoldSeat(
  ctx: DecideContext,
  session: ClassSession,
  input: { holdId: string; note: string; cardNumber: string | null },
): Result<SeatHoldOutcome, DomainError> {
  if (session.status === 'cancelled') return err({ code: 'session_not_editable' })
  const note = input.note.trim()
  if (note.length === 0) return err({ code: 'seat_hold_note_required' })
  if (occupiedSeats(session) >= session.capacity) return err({ code: 'class_full', capacity: session.capacity })

  const heldCountAfter = (session.heldCount ?? 0) + 1
  const hold: SeatHold = {
    id: input.holdId,
    studioId: ctx.studioId,
    branchId: session.branchId,
    classSessionId: session.id,
    note,
    cardNumber: input.cardNumber?.trim() || null,
    status: 'held',
    sessionStartsAt: session.startsAt,
    heldAt: ctx.now,
    heldBy: ctx.actor,
    releasedAt: null,
    releasedBy: null,
    arrivedAt: null,
    arrivedBy: null,
  }
  return ok({
    hold,
    session: { ...session, heldCount: heldCountAfter },
    events: [
      {
        ...base(ctx, 'classSession', session.id, session.branchId, { classSessionId: session.id }),
        type: CLASS_SESSION_SEAT_HELD,
        payload: { holdId: hold.id, heldCountAfter, bookedCount: session.bookedCount, capacity: session.capacity },
      },
    ],
  })
}

// Releasing is idempotent-by-refusal rather than idempotent-by-silence: releasing an already
// released hold is a mistake worth surfacing, not a no-op worth hiding. The counter is floored at
// zero so a double-release can never make a session look emptier than it is.
export function decideReleaseSeat(
  ctx: DecideContext,
  session: ClassSession,
  hold: SeatHold,
): Result<SeatHoldOutcome, DomainError> {
  if (hold.status !== 'held') return err({ code: 'seat_hold_not_open' })

  const heldCountAfter = Math.max(0, (session.heldCount ?? 0) - 1)
  return ok({
    hold: { ...hold, status: 'released', releasedAt: ctx.now, releasedBy: ctx.actor },
    session: { ...session, heldCount: heldCountAfter },
    events: [
      {
        ...base(ctx, 'classSession', session.id, session.branchId, { classSessionId: session.id }),
        type: CLASS_SESSION_SEAT_RELEASED,
        payload: { holdId: hold.id, heldCountAfter },
      },
    ],
  })
}

// ── MİSAFİR GELDİ (owner, 2026-09-14 · OR-76) ────────────────────────────────────────────────
//
// *"yer ayırdığımız kişiler ... sistemde olmayabilir dolayısıyla qr okutamazlar ... resepsiyon elle
// giriş - çıkışına izin versin ve olay kaydında bu kişiye ilişkilendirilsin ... yoklamalar daha tutarlı
// olacak."*
//
// Resepsiyon ayrılan yerin satırından "Giriş"e basınca misafir GELDİ diye yazılır. Bu bir GÖZLEM (#11):
// kişi kapıdan geçti. Yer ayırmak yalnızca bir niyetti; ikisi ayrı kalır ki "kaç misafir gerçekten
// geldi" sorusu cevaplanabilsin.
//
//   • YALNIZCA SEANSIN GÜNÜ. Geçmiş bir dersin satırından bugün basılan "Giriş", o derse bugün gelinmiş
//     gibi yazardı. Gün stüdyonun yerel günü; eşik yok, sayı yok (#4).
//   • İKİNCİ GİRİŞ YENİ OLAY YAZMAZ. Arada çıkıp dönen misafir iki kez gelmiş olmaz; ilk geliş saati kalır.
//     Kol yine döner — o bu fonksiyonun işi değil.
//   • Kaldırılmış yer ve iptal edilmiş seans reddedilir.
//   • İSİM YOK (#6): olayda yalnızca `holdId`. Misafirin adı ayrılan yer belgesinde, durumda kalır.
export interface GuestArrivalOutcome {
  readonly hold: SeatHold
  /** Boş ⇔ misafir zaten gelmişti; yazılacak bir şey yok. */
  readonly events: readonly NewEvent[]
}

export function decideGuestArrival(
  ctx: DecideContext,
  session: ClassSession,
  hold: SeatHold,
  utcOffsetMinutes: number,
): Result<GuestArrivalOutcome, DomainError> {
  if (hold.status !== 'held') return err({ code: 'seat_hold_not_open' })
  if (session.status === 'cancelled') return err({ code: 'session_not_editable' })
  if (localDateAt(session.startsAt, utcOffsetMinutes) !== localDateAt(ctx.now, utcOffsetMinutes)) {
    return err({ code: 'guest_arrival_not_today' })
  }
  if (hold.arrivedAt !== null) return ok({ hold, events: [] })

  return ok({
    hold: { ...hold, arrivedAt: ctx.now, arrivedBy: ctx.actor },
    events: [
      {
        ...base(ctx, 'classSession', session.id, session.branchId, { classSessionId: session.id, seatHoldId: hold.id }),
        type: CLASS_SESSION_GUEST_ARRIVED,
        payload: { holdId: hold.id },
      },
    ],
  })
}
