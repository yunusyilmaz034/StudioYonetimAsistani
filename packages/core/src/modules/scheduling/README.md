# scheduling

The general time layer (Doc 11). Services, rooms, weekly templates, and dated class
sessions — the substrate reservations (v1.8) will book against. No reservations,
credit, or attendance here.

## Public API (`index.ts`)

- Types: `Service`, `Room`, `ClassTemplate`, `ClassSession`, `SchedulingPolicy`, …
- Services: `createService`, `updateService`, `publishServicePolicy`, `deactivate/reactivateService`
- Rooms: `createRoom`, `updateRoom`, `deactivate/reactivateRoom`
- Templates: `createTemplate`, `updateTemplate`, `deactivateTemplate`
- Sessions: `scheduleSession`, `generateSessions`, `cancelSession`, `changeTrainer`,
  `changeRoom`, `changeCapacity`
- Reads: `getSession`, `listSessionsForDay` (any range), `listServices`, `listRooms`,
  `listTemplates`
- `SchedulingRepository`, `SchedulingDeps`, `FirestoreSchedulingRepository`

## Invariants this module owns

- **I-22** — `ClassSession.category` is the Service's category at creation; a
  Service's category is immutable (the wall's source).
- **I-23** — if `roomId` is set, `session.capacity ≤ room.capacity` and
  `session.branchId == room.branchId`.
- **I-24** — every session stamps the Service's `policyVersion` + a `policySnapshot`.
- **I-25** — a template generates sessions only within `[validFrom, validUntil]`,
  idempotent per `(templateId, occurrence)`.
- **I-26** — a **started or completed** session is never editable; trainer/room/
  capacity edits require a not-yet-started, still-`scheduled` session (v1.12, AD-62).

## Notes

- Templates are wall-clock only (LocalDate + `HH:MM`); the application derives
  `startsAt: Instant` (UTC) via `StudioConfig.utcOffsetMinutes` (AD-52).
- Domain never sees Firestore ids or `Date`; the repo maps ids and the application
  does time math.
- `trainerName` on generated sessions is `null` until the identity module resolves
  it (denormalised, rebuildable).


## Seats held for non-members (2026-07-27)

Multisport visitors are **day guests**: they write to the studio's WhatsApp asking whether there is
room, and reception puts a name against a seat. They buy nothing, have no account, and the owner is
explicit that they must **not** be registered as members — because they are not.

It is deliberately **not a reservation**. A reservation has a member and an entitlement, and every
piece of machinery downstream — the credit ledger, the roster, member stats, attendance, payroll —
assumes both. Inventing a fake member to satisfy that would put a person who does not exist into the
studio's numbers permanently.

| | Reservation | Seat hold |
|---|---|---|
| Who | a member | anyone, named in free text |
| Credit | held → consumed | none, ever |
| Appears in | roster, member stats, payroll counts | the seat-hold list only |
| Occupies a seat | yes | **yes** |

**`occupiedSeats(session)` is the only correct way to ask how full a class is.** Anything that reads
`bookedCount` alone will hand out a seat that reception already promised. It is enforced in
`decideBooking`, `decideMove`, the bulk-move preview and the waitlist gate, and the web query
mappers expose the sum so every screen — including the member portal — renders the truth.

**Members see the number and nothing else** (owner): a portal that said *"rezerve"* would invite
"kim için, ben de isteyebilir miyim?" and put a paying member and a day guest in visible tiers. Why a
seat is taken is not another member's business.

**`/seatHolds` is the one place third-party PII lands.** The guest's name and card number live on the
document — never in an event (I-13), exactly as a member's name lives on the reservation and never in
`reservation.booked`. The collection is `serverOnly` in the security rules: it is read through a
Server Action behind the desk role, never over the client SDK. **Retention is currently unbounded** —
if the studio starts holding many seats, a purge of released holds is the repayment.
