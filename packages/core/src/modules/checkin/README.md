# `checkin` — check-in, occupancy, and the branch window

## Purpose

**Check-in ≠ attendance** (Doc 2 §2, §9). `member.checked_in` = walked through the door
→ **occupancy** (*"23 members inside"*). It allocates nothing and holds nothing, which
is why it is idempotent and offline-safe. It is the independent observation behind the
churn signal *"presumed attended, never checked in"* (DEBT-007).

## Public API (`index.ts`)

- **Types** — `CheckIn`, `Presence`, `BranchOccupancy`, `CheckInMethod`,
  `CheckInDirection`.
- **Command** — `CHECKIN_RECORD` / `CheckInRecordPayload` (the `/commands` surface).
- **Deciders** (`domain/decide.ts`) — `decideCheckIn` (a **toggle** from presence
  state), `decideAutoCheckOut`, `decideOpenBranch`, `decideCloseBranch`. Pure.
- **Use-cases** — `recordCheckIn` (applied by `on-command-created`), `openBranch` /
  `closeBranch` (Server Actions), `sweepAutoCheckOut` (nightly `system` sweep).
- **Infrastructure** — `FirestoreCheckinRepository` (Admin SDK only, AD-15). Reads
  include `getPresence` / `listPresence` / `listCheckInsForDay` and
  `listCheckInsByMember` (Member Workspace history, v1.18).

## State (Doc 3)

```
/checkIns/{id}        the append-style in/out log
/presence/{memberId}  one doc per member inside — existence IS the toggle state
/branches/{branchId}  occupancy window { isOpen, openedAt } (merge-only)
```

Occupancy is `count(/presence where branchId == X)` — a bounded read, **not** a
projection (those are Phase 2). `member.checked_in` also carries `occupancyAfter`, so
the number is reconstructable from the log alone (AD-19).

## Rules this module enforces

- **Check-in ≠ attendance** — different events, producers, consequences. Never conflated.
- **The producer never appears in the type** (AD-18) — a reception tap, a QR scan, and
  a future turnstile all emit `member.checked_in`; `method` is metadata (D7), `actor`
  is who is responsible (the receptionist — never the member, D2).
- **A check-in is only allowed while the branch is open** (D3, `branch_not_open`).
- **A member inside past the threshold is auto-checked-out** by the `system` sweep
  (D4) — occupancy is a within-day figure and must return to zero.
- **No PII in any payload** (I-13) — only `memberId` / `branchId`.

## The QR

The member's QR encodes the opaque `memberId` (D1) — generated client-side in the
member workspace, printable. Reception scans it (D2); the scan and the manual "Üye Ara"
search both write the same `checkIn.record` command.
