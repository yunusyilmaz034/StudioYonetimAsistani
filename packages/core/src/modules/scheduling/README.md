# scheduling

The general time layer (Doc 11). Services, rooms, weekly templates, and dated class
sessions — the substrate reservations (v1.8) will book against. No reservations,
credit, or attendance here.

## Public API (`index.ts`)

- Types: `Service`, `Room`, `ClassTemplate`, `ClassSession`, `SchedulingPolicy`, …
- Services: `createService`, `updateService`, `publishServicePolicy`, `deactivate/reactivateService`
- Rooms: `createRoom`, `updateRoom`, `deactivate/reactivateRoom`
- Templates: `createTemplate`, `deactivateTemplate`
- Sessions: `scheduleSession`, `generateSessions`, `cancelSession`, `changeTrainer`
- `SchedulingRepository`, `SchedulingDeps`, `FirestoreSchedulingRepository`

## Invariants this module owns

- **I-22** — `ClassSession.category` is the Service's category at creation; a
  Service's category is immutable (the wall's source).
- **I-23** — if `roomId` is set, `session.capacity ≤ room.capacity` and
  `session.branchId == room.branchId`.
- **I-24** — every session stamps the Service's `policyVersion` + a `policySnapshot`.
- **I-25** — a template generates sessions only within `[validFrom, validUntil]`,
  idempotent per `(templateId, occurrence)`.

## Notes

- Templates are wall-clock only (LocalDate + `HH:MM`); the application derives
  `startsAt: Instant` (UTC) via `StudioConfig.utcOffsetMinutes` (AD-52).
- Domain never sees Firestore ids or `Date`; the repo maps ids and the application
  does time math.
- `trainerName` on generated sessions is `null` until the identity module resolves
  it (denormalised, rebuildable).
