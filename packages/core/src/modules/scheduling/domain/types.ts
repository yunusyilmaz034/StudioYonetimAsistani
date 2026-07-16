import type {
  BranchId,
  Category,
  ClassSessionId,
  ClassTemplateId,
  Instant,
  LocalDate,
  MemberId,
  RoomId,
  ServiceId,
  StaffUserId,
  StudioId,
} from '../../../shared'

// The scheduling-relevant policy: reservation window, cancellation, late, and
// attendance defaults. Embedded on the Service, versioned, snapshotted onto each
// session (AD-49). Freeze/credit policy stays product-attached (Doc 2 §10).
export interface SchedulingPolicy {
  readonly maxDaysInAdvance: number
  // D14 (v1.21) — `null` means "I have no opinion; inherit the studio default". Before D14
  // this was a required number on every service, which made the studio default unreachable:
  // every session has a service, and every service had a concrete number, so levels 3 and 4 of
  // the chain could never fire. Inheritance is only real if a level can decline to answer.
  readonly cancellationWindowHours: number | null
  readonly lateCancellationConsumesCredit: boolean
  readonly noShowConsumesCredit: boolean
  readonly attendanceDefaultOutcome: 'attended' | 'no_show'
  readonly autoResolveAfterMinutes: number
  // D11 (v1.21) — may a MEMBER book this service herself, from the portal? Versioned policy
  // data, never an `if` in the portal (non-negotiable #4). Defaults to false for services that
  // predate it: self-booking is opt-in, because turning it on gives away scarce capacity.
  readonly allowMemberSelfBooking: boolean
}

// D14 — where the session's effective cancellation window came from. Recorded so that a year
// from now the log can answer "why was this class 4 hours?" without re-deriving a chain from
// settings that have since changed.
export type CancellationWindowSource = 'session' | 'service' | 'studio'

// What is STAMPED on a session (I-24). The difference from `SchedulingPolicy` is the point of
// D14: by the time a session exists, the chain has been RESOLVED — so the window is a number,
// never null, and it carries its provenance. Everything downstream (the cancel decider, the
// owner UI, the member portal) reads this and only this.
export type SessionPolicySnapshot = Omit<SchedulingPolicy, 'cancellationWindowHours'> & {
  readonly cancellationWindowHours: number
  readonly cancellationWindowSource: CancellationWindowSource
}

// D14 — studio-level defaults. Level 3 of the chain. The "system default" (6 h) is NOT in the
// code: nothing in the domain knows the number six (non-negotiable #4). It is the value a
// studio is PROVISIONED with — data, written once at installation. If no level answers, the
// domain refuses (`cancellation_window_unresolved`) rather than inventing a number.
export interface StudioSettings {
  readonly studioId: StudioId

  // ── Settings that CHANGE A DOMAIN DECISION ────────────────────────────────────────────────
  // These are logged with their previous AND new values (owner, 2026-07-13), because a member who
  // booked under a six-hour window and was judged under a twelve-hour one deserves an answer that
  // is not "we changed it at some point". A rule that cannot be reconstructed cannot be defended.

  readonly defaultCancellationWindowHours: number | null
  // v1.23 (owner, D-4) — the dashboard's "kredisi azalan üye" threshold. Data, never an `if`
  // (#4: nothing in the code knows the number six, and nothing knows the number two either).
  // Absent ⇒ the studio was provisioned before this existed; the dashboard uses 2 and says so.
  readonly lowCreditThreshold: number | null
  // v1.24 (owner, decision 4) — the discount ceiling, as a percentage of the sale's gross. DATA,
  // never a literal: reception giving 40 % is either a kindness or a leak, and only the owner knows
  // which. Above the ceiling, only the owner may approve. Absent ⇒ no ceiling.
  readonly discountCeilingPercent: number | null
  // v1.27 S2 — what the session form starts with. Not a rule, but it decides what reception clicks
  // fifty times a week, and getting it wrong is fifty corrections.
  readonly defaultSessionDurationMinutes: number | null

  // ── Configuration. Logged as FIELD NAMES ONLY (owner, 2026-07-13) ─────────────────────────
  // A tax number, an address and a phone are business PII, and the log is permanent. The audit
  // answers *which fields changed, when, by whom* — never *to what*.

  /** IANA (`Europe/Istanbul`). Stored; the UTC offset is DERIVED from it (shared/studio-config). */
  readonly timeZone: string
  readonly company: CompanyInfo | null
  /** Every day of the week, on its own. `null` = closed that day. */
  readonly workingHours: WorkingHours | null
  readonly qr: QrSettings | null
  /** v1.27 S2 (DEBT-024). Quiet hours, the daily ceiling, and which channels are on. Data, not a
   *  literal — a studio that wants a different quiet window should not need a deploy. */
  readonly notifications: NotificationSettings | null
  /** Plus Phase 8 — the studio's physical capacity and occupancy bands (Sakin/Orta/Yoğun/Çok yoğun).
   *  DATA, never a literal. Shape MIRRORS the fitness module's `FitnessOccupancyConfig` — declared
   *  here rather than imported so `scheduling` does not fall behind `fitness` in the graph for one
   *  struct (the same reason `notifications` is mirrored above). `null` ⇒ never configured. */
  readonly fitness: FitnessOccupancyConfig | null
}

// Mirrors the fitness module's `FitnessOccupancyConfig` (see the note on `notifications`). Capacity
// in people; the `*At` values are ascending fractions (0..1) of it. Capacity 0 = unset.
export interface FitnessOccupancyConfig {
  readonly capacity: number
  readonly moderateAt: number
  readonly busyAt: number
  readonly veryBusyAt: number
}

// Mirrors the notifications module's own type. It is DECLARED here rather than imported because a
// cross-module import would put `scheduling` behind `notifications` in the dependency graph for one
// struct — and the modules have one public door each, deliberately (AD-36's cousin). The shape is
// three numbers and a list; the day it grows a rule, it moves.
export interface NotificationSettings {
  /** Operational messages per day. A ceiling, so a bug cannot invoice the studio. */
  readonly dailyLimit: number
  readonly quietFromHour: number // 22
  readonly quietToHour: number // 8
  /** `in_app` is ALWAYS present and cannot be removed: it is not a message, it is the member's
   *  record of what happened to her account. She may say "not by e-mail"; she may not say "never
   *  tell me my class was cancelled". */
  readonly enabledChannels: readonly string[]
}

// The single source of truth for every output the studio produces — the receipt, the e-mail, the
// WhatsApp template, and one day the e-fatura. Written once, read everywhere; a company name typed
// into a template is a company name that will be wrong in one of them.
export interface CompanyInfo {
  readonly legalName: string // ticari unvan
  readonly displayName: string // what a member sees
  readonly taxOffice: string
  readonly taxNumber: string
  readonly phone: string
  readonly email: string
  readonly website: string | null
  readonly address: string
}

/** `HH:MM` wall-clock, in the studio's timezone. */
export interface DayHours {
  readonly open: string
  readonly close: string
}

/** Indexed by `Weekday` (0 = Sunday). `null` = closed. Every day stands on its own: a studio that is
 *  open 10–21 on weekdays and 11–17 on Saturday is the normal case, not the exception. */
export type WorkingHours = Readonly<Record<Weekday, DayHours | null>>

export interface QrSettings {
  /** How long a minted check-in token lives. Short by design: a screenshot must die quickly. */
  readonly tokenTtlSeconds: number
  /** How far before a class starts a member may check in for it. */
  readonly checkInWindowMinutes: number
}

export interface Service {
  readonly id: ServiceId
  readonly studioId: StudioId
  readonly name: string
  readonly category: Category // immutable after creation (I-22)
  readonly policy: SchedulingPolicy
  readonly policyVersion: number
  readonly active: boolean
}

export interface Room {
  readonly id: RoomId
  readonly studioId: StudioId
  readonly branchId: BranchId
  readonly name: string
  readonly capacity: number
  readonly active: boolean
}

export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6

export interface ClassTemplate {
  readonly id: ClassTemplateId
  readonly studioId: StudioId
  readonly branchId: BranchId
  readonly serviceId: ServiceId
  readonly roomId: RoomId | null
  readonly trainerId: StaffUserId | null
  readonly dayOfWeek: Weekday
  readonly startTime: string // 'HH:MM' local
  readonly durationMinutes: number
  readonly capacity: number
  readonly validFrom: LocalDate
  readonly validUntil: LocalDate
  readonly active: boolean
}

export type ClassSessionStatus = 'scheduled' | 'in_progress' | 'completed' | 'cancelled'

// The class note (Ders Notu). Free text is the core — kept intact for members and,
// later, AI (owner directive). `visibility` decides whether it reaches the member
// portal. EXTENSIBLE BY DESIGN: future additions (attachments, links, ai suggestions)
// are ADDITIVE optional fields on this record and on the note_set event — events are
// versioned, so adding an optional field never breaks the existing model.
export type NoteVisibility = 'staff' | 'members'
export interface SessionNote {
  readonly text: string
  readonly visibility: NoteVisibility
  readonly setAt: Instant
  // future (do not build yet): attachments?, links?, aiSuggestion? — all additive.
}

export interface SessionCancellation {
  readonly reason: string
  readonly at: Instant
}

export interface ServicePolicyRef {
  readonly serviceId: ServiceId
  readonly version: number
}

export interface ClassSession {
  readonly id: ClassSessionId
  readonly studioId: StudioId
  readonly branchId: BranchId
  readonly serviceId: ServiceId
  readonly roomId: RoomId | null
  readonly trainerId: StaffUserId | null
  readonly templateId: ClassTemplateId | null
  readonly category: Category // snapshot of the service's category (I-22)
  // D13 (v1.21, final — owner 2026-07-12) — PT ownership is MODELLED, never inferred from
  // whether a reservation happens to exist. Only meaningful when category === 'private':
  //
  //   • null → an OPEN PT slot. This is the default and it is NOT "unavailable" or "hidden":
  //            any member whose package covers the PT service sees it and may book it, under
  //            the ordinary capacity and eligibility rules. Booking it does NOT assign it —
  //            the field stays null. Fullness is governed by `capacity`, never by this field
  //            (a future partner/duo PT may have capacity 2).
  //
  //   • set  → a RESERVED slot: it belongs to that member. Only she sees it and only she may
  //            be booked into it (I-9.9) — even a member with a valid PT package cannot.
  //            Clearing it turns the slot back into an open one.
  //
  // Ownership is INDEPENDENT of capacity. There is deliberately no `capacity === 1` rule.
  // Sessions created before D13 have no field ⇒ read as null ⇒ an open PT slot, which is
  // exactly what they were. Never backfilled.
  readonly assignedMemberId: MemberId | null
  readonly startsAt: Instant
  readonly endsAt: Instant
  readonly capacity: number
  readonly status: ClassSessionStatus
  readonly cancellation: SessionCancellation | null
  readonly policyRef: ServicePolicyRef
  readonly policySnapshot: SessionPolicySnapshot // I-24 + D14 (window resolved & stamped)
  readonly bookedCount: number // starts 0; reservations are v1.8
  readonly attendedCount: number
  readonly note?: SessionNote | null // the class note (Ders Notu); optional/additive
  // denormalised for the roster/calendar read (rebuildable):
  readonly serviceName: string
  readonly roomName: string | null
  readonly trainerName: string | null
  readonly branchName: string
}
