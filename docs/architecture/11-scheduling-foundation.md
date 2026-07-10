# 11 — Scheduling Foundation

**Status:** binding · **Date:** 2026-07-10
**Extends:** Doc 02 (domain), Doc 03 (Firestore), Doc 04 (events).

The general time layer of the Studio Operating System. It is **not** a reservation
system — reservations (v1.8) feed on it. It is designed to later carry group
classes, PT, 1:1 sessions, room bookings, trainer shifts, days off, holidays, and
special events, without a data migration.

**v1.7a builds:** domain + Firestore + events + policy + server + tests.
**v1.7b builds:** the management UI. **Out of both:** member reservation, credit,
attendance, waitlist, payment, notification, AI.

---

## 1. Domain objects

### Service *(new)* — the configurable schedulable activity
`Service` is data (created/edited by the owner), not code. `category` stays the
**closed enum** (`pilates_group | fitness | private`, AD-41) that powers the
category wall (I-9.7); a Service adds a configurable layer on top of it.

```
Service { id: ServiceId; studioId; name; category: Category (immutable after create);
          policy: SchedulingPolicy; policyVersion: number; active: boolean }
```

### Room *(new)* — a physical space
```
Room { id: RoomId; studioId; branchId; name; capacity: number; active: boolean }
```

### ClassTemplate *(new)* — a weekly recurring slot
```
ClassTemplate { id: ClassTemplateId; studioId; branchId; serviceId; roomId | null;
                trainerId: StaffUserId | null; dayOfWeek: 0..6; startTime: 'HH:MM';
                durationMinutes; capacity; validFrom: LocalDate; validUntil: LocalDate;
                active: boolean }
```

### ClassSession *(extends Doc 02 §7)* — a dated instance
Adds `serviceId`, `roomId`, `serviceName`/`roomName` (denormalised), and a stamped
policy. `category` is snapshotted from the Service at creation (the wall source).
```
ClassSession { id; studioId; branchId; serviceId; roomId | null; trainerId | null;
               templateId | null; category (snapshot); startsAt; endsAt; capacity;
               status: scheduled|in_progress|completed|cancelled; cancellation | null;
               policyRef: { serviceId; version }; policySnapshot: SchedulingPolicy;
               bookedCount: 0; attendedCount: 0;
               serviceName; roomName | null; trainerName | null; branchName }
```

### SchedulingPolicy *(embedded in Service, versioned — AD-49)*
The reservation/attendance rules for a service. Held on the Service, versioned via
`policyVersion`, and **snapshotted onto each Session at creation** so v1.8 reads the
rules the session was created under without a historical lookup (D3).
```
SchedulingPolicy { maxDaysInAdvance; cancellationWindowHours;
                   lateCancellationConsumesCredit; noShowConsumesCredit;
                   attendanceDefaultOutcome: 'attended'|'no_show';
                   autoResolveAfterMinutes }
```
Freeze/credit policy stays product/entitlement-attached (Doc 02 §10); this is only
the scheduling-relevant subset.

---

## 2. Events *(broad from day one — no future migration, only additive new types)*

| Type | Payload (no PII) |
|---|---|
| `service.created` | `{ name, category, policyVersion }` |
| `service.updated` | `{ changedFields[] }` |
| `service.policy_published` | `{ policyVersion, changedFields[] }` |
| `service.deactivated` / `.reactivated` | `{ reason? }` / `{}` |
| `room.created` | `{ branchId, name, capacity }` |
| `room.updated` | `{ changedFields[] }` |
| `room.deactivated` / `.reactivated` | `{ reason? }` / `{}` |
| `class_template.created` | `{ serviceId, branchId, dayOfWeek, startTime, durationMinutes, capacity, validFrom, validUntil }` |
| `class_template.updated` | `{ changedFields[] }` |
| `class_template.deactivated` | `{ reason }` |
| `class_session.scheduled` | `{ serviceId, branchId, roomId?, trainerId?, templateId?, category, startsAt, endsAt, capacity, policyVersion }` |
| `class_session.cancelled` | `{ reason, startsAt }` |
| `class_session.trainer_changed` | `{ from?, to?, reason }` |

`class_session.completed` and reschedule/shift/holiday events are **added later**
(new types need no migration; only payload shapes are permanent — AD-21).

---

## 3. Firestore *(new collections — Doc 03)*

```
/studios/{sid}/services/{serviceId}        SchedulingPolicy embedded + policyVersion
/studios/{sid}/rooms/{roomId}
/studios/{sid}/classTemplates/{templateId}
/studios/{sid}/classSessions/{sessionId}   policySnapshot stamped; bookedCount starts 0
```

Reads: tenant-scoped (existing wildcard rule). Writes: **server-side only** (AD-15);
`allow write: if false`. Indexes: `classSessions (branchId ASC, startsAt ASC)`,
`classSessions (status ASC, startsAt ASC)`, `services (active ASC)`,
`classTemplates (active ASC, dayOfWeek ASC)`. The domain never sees a Firestore
document id (AD-44 pattern); the repository maps `<Id> ↔ document id`.

---

## 4. Authorization *(AD-51)*

| Operation | Who |
|---|---|
| Service / Room / ClassTemplate — create/edit/deactivate | **owner + platform_admin** |
| ClassSession — create/edit/cancel/change-trainer (daily ops) | **owner + receptionist + platform_admin** |
| Trainer | no management authority today |

**Trainer seam:** every `ClassSession` carries `trainerId`, so a future rule
"a trainer may act on a session where `session.trainerId == actor.id`" is addable
with no model change. Enforced in the Server Action (AD-46 pattern), not in rules.

---

## 5. Invariants added

| # | Invariant |
|---|---|
| **I-22** | `ClassSession.category` equals the Service's category at creation (the wall's source, snapshot). A Service's `category` is immutable. |
| **I-23** | If `roomId` is set, `session.capacity ≤ room.capacity` and `session.branchId == room.branchId`. |
| **I-24** | Every `ClassSession` stamps the Service's `policyVersion` and a `policySnapshot` at creation (D3). |
| **I-25** | A template generates sessions only within `[validFrom, validUntil]`; generation is idempotent per `(templateId, date)`. |

---

## 6. Session generation *(AD-50)*

A weekly `ClassTemplate` generates concrete `ClassSession`s **eagerly** (materialised
N weeks ahead), each stamping the service policy. Generation is **idempotent** per
`(templateId, occurrenceDate)` — re-running never duplicates. One-off sessions are
created directly (no template). Sessions are the substrate reservations will book
against (v1.8).

---

## 7. Decisions

| # | Decision | Rejected | Rationale |
|---|---|---|---|
| **AD-47** | `Service` is a configurable entity; `category` stays a closed enum on top of it | Replace the enum with free-form services | Keeps the category wall (I-9.7, AD-41) type-safe while making services data. |
| **AD-48** | `Room` is a first-class branch-scoped entity; session capacity ≤ room capacity | Capacity only on the session | Rooms are real physical limits and the seed for future room bookings. |
| **AD-49** | `SchedulingPolicy` is embedded on the Service, versioned, and snapshotted onto each session | A separate policy collection / product-only policy | Policy lives with what it governs; the session carries the rules it was created under (D3), no historical lookup. |
| **AD-50** | Weekly templates generate sessions **eagerly and idempotently** | Virtual/lazy sessions | Sessions must be concrete rows for reservations, occupancy, and the calendar to read. |
| **AD-51** | Definitions: owner + platform_admin. Sessions: + receptionist. Trainer: none now, `session.trainerId` is the future seam | Give reception full scheduling; or build trainer authz now | Matches daily ops; the seam costs nothing and avoids a future migration. |
| **AD-52** | Templates hold **only** `LocalDate` + `HH:MM` (never UTC). The application converts to `startsAt: Instant` (UTC) using `StudioConfig.utcOffsetMinutes` (Phase 1 = +180, Türkiye, no DST). No magic number — it comes from `StudioConfig`. | Store UTC on templates; hardcode the offset | A template is a wall-clock rule; the Instant is derived. When a Studio entity carries an IANA timezone, `utcOffsetMinutes` derives from it — a seamless migration, no session rewrite. |
