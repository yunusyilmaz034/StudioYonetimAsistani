# 15 — QR Access & Check-in · Design (v1.15)

> **Status: IMPLEMENTED (v1.15). Decisions D1–D7 resolved (see §9).**
> Built as designed: the `checkin` module (`decideCheckIn` toggle, branch open/close,
> auto-check-out sweep), the `checkIn.record` dispatch on `on-command-created`, the
> `/checkin` reception screen (QR scan + member search), and the member QR card.
> This document analyses the domain, event model, Firestore shape, UI flows, and
> technical design for the v1.15 milestone. It implements Doc 2 §9 and Doc 4
> §"Check-in"; where they disagree, **Doc 2/Doc 4 win.**
>
> **Locked scope:** QR encodes `memberId` (D1); reception-operated scan only (D2);
> occupancy is bounded by **`branch.opened`/`branch.closed`** (D3); a nightly `system`
> **auto-check-out at 4h** (D4); in/out is a **toggle** (D5); the "expected but absent"
> reception rule ships in a **simple** form (D6); `method: 'qr'` records the input (D7).

---

## 1. Purpose & scope

**Check-in produces occupancy — the answer to "how many members are inside right
now?"** It is the last operational surface before the owner dashboard, and the
independent observation that powers the churn signal *"presumed attended, never
checked in"* (DEBT-007, computable from Phase-1 data alone).

**The non-negotiable that governs this milestone:** `member.checked_in` ≠
`reservation.attended`. Walking through the door (occupancy) is a different event,
from a different producer, with a different consequence, than being observed in class
(credit consumption). Conflating them poisons both metrics permanently (Doc 2 §2, §9).

**In scope (v1.15) — locked:**
- A `checkin` core module: the `CheckIn` record, a pure `decideCheckIn` toggle decider,
  and its events.
- The **offline command path** for check-in — `checkIn.record` is *already* whitelisted
  in the security rules (Doc 3 §5). A dispatch entry is added to the existing
  `on-command-created` trigger (built in v1.10).
- **QR check-in**, reception-operated (D1/D2): reception scans a member's QR (device
  camera; the QR encodes `memberId`) → one `checkIn.record` → `member.checked_in` /
  `member.checked_out`.
- **Branch open/close (D3):** reception opens and closes the branch
  (`branch.opened` / `branch.closed`); occupancy is bounded by the open period and
  resets to zero at close.
- **Auto-check-out (D4):** a nightly `system` sweep checks out anyone still inside
  past **4 h** — `member.auto_checked_out`. The threshold is policy data (the code
  never knows the number four).
- A **live occupancy** read and a reception check-in screen; a simple "expected but
  absent" reception rule (D6).

**Deferred (Phase 2):**
- **Member self-service QR** (an unsupervised kiosk). v1.15 keeps check-in
  reception-responsible (actor = receptionist), even when the input is a QR (D2).
- The **occupancy projection** (`projections/` is Phase 2). v1.15 computes occupancy
  from the `/checkIns` collection directly (a bounded, indexed read).

**Explicitly out (all phases of this milestone):** turnstile/door hardware, payment,
notifications, the member portal.

---

## 2. Domain analysis

### 2.1 The CheckIn record (Doc 2 §9)

```ts
type CheckIn = {
  id: CheckInId
  studioId: StudioId
  memberId: MemberId
  branchId: BranchId
  direction: 'in' | 'out'
  method: 'reception' | 'qr' | 'device'   // 'device' unused in Phase 1
  occurredAt: Instant                      // domain time (may be offline, clamped)
  recordedAt: Instant                      // serverTimestamp
  actor: ActorRef                          // the receptionist (never the member in v1.15)
}
```

A check-in **allocates nothing and holds nothing** — which is precisely why it is
idempotent and offline-safe (Doc 3 §"Which commands may be offline").

### 2.2 Direction — the in/out toggle

A member is either **inside** or **outside** a branch. The cleanest model: a member
carries a small denormalised state — `checkedInAt: Instant | null` (and `branchId`) —
`null` ⇔ outside. `decideCheckIn` reads that state and **toggles**:

- member outside → emit `member.checked_in`, set `checkedInAt`.
- member inside → emit `member.checked_out`, clear `checkedInAt`, compute
  `durationMinutes`.

One scan = one toggle. A double-tapped scan is absorbed by **`commandId` idempotency**
(Doc 4 §"Idempotency"): the same command id produces at most one event.

*(Alternative: explicit in/out buttons in the UI. Toggle is fewer taps [UX-9] and
matches a turnstile's future behaviour; explicit is less surprising. → Decision D5.)*

### 2.3 Occupancy

*"There are currently 23 members inside"* is `count(checked_in) − count(checked_out)`
since the branch opened, **per branch**. It **will drift** (members leave without
checking out) — this is a fact about studios, not a bug (Doc 2 §9). Two honest
mitigations, both in Doc 2:
- occupancy is a **within-day** figure, reset at `branch.closed` (or a day boundary);
- a member inside longer than *N* hours is **auto-checked-out** by the `system`
  actor (OQ-9, suggested 4h).

`member.checked_in` carries `occupancyAfter` in its payload (semi-fat, AD-19), so the
number is reconstructable from the log alone and the live read never has to be the
source of truth.

---

## 3. Event model (Doc 4 §"Check-in")

**No new event types are invented** — all four already exist in the Doc 4 catalogue.
This milestone *produces* them for the first time.

| Event | Payload | Producer / actor |
|---|---|---|
| `member.checked_in` | `{ branchId, method, occupancyAfter }` | receptionist (input: reception \| qr) |
| `member.checked_out` | `{ branchId, method, durationMinutes, occupancyAfter }` | receptionist |
| `member.auto_checked_out` | `{ branchId, thresholdHours }` | **`system`** (OQ-9) |
| `branch.opened` | `{ scheduledOpenAt }` | receptionist → door sensor later |
| `branch.closed` | `{ occupancyAtClose }` | receptionist → door sensor later |

**PII rule (I-13):** none of these carry a name or phone — only `memberId`/`branchId`.
Identity stays in `/members`.

**The producer never appears in the type (AD-18, D1).** `method` is metadata on the
payload; a QR scan and a reception tap and a 2027 turnstile all emit `member.checked_in`.
The rule that reads occupancy never branches on `method`.

`branch.opened/closed` (D3) and `member.auto_checked_out` (D4) are **in v1.15**. The
`system` auto-check-out threshold is **policy data** (Doc 2 §10 pattern) — the code
never knows the number four; it reads it from `StudioConfig`/policy and stamps it on
the event's `thresholdHours`.

---

## 4. Firestore structure (Doc 3)

```
/studios/{sid}/
    checkIns/{checkInId}     ← append-style log of in/out records
    commands/{commandId}     ← checkIn.record (ALREADY whitelisted, Doc 3 §5)
    members/{memberId}       ← + checkedInAt: Timestamp|null, checkedInBranchId: BranchId|null
    branches/{branchId}      ← + isOpen, openedAt (if branch.opened is in scope, D3)
    events/{eventId}         ← the five event types above
```

- **Index:** `checkIns (branchId ASC, occurredAt DESC)` — already listed in Doc 3 §
  indexes as *"Live occupancy"*. No other new index needed.
- **Member denormalisation:** `checkedInAt` / `checkedInBranchId` (rebuildable from the
  check-in log) let `decideCheckIn` know in/out state and let the roster show
  *"currently inside"*. Registered in the denormalised-field register (Doc 3 §6).
- **Security rules:** unchanged. `checkIn.record` is already in the `/commands`
  whitelist; `/checkIns` is tenant-readable via the existing wildcard, Admin-SDK-write
  only. **No rules change** unless we add a second command type (we do not).

---

## 5. The offline command path (reuse, not rebuild)

```
Reception scans QR / taps
        │  client writes /commands/{ulid}
        ▼
/commands/{id}  { type:'checkIn.record', actor:<receptionist>, payload:{ memberId, branchId, direction? }, occurredAt, status:'pending' }
        │  on-command-created trigger (v1.10) — NEW dispatch entry for checkIn.record
        ▼
load member state → decideCheckIn (pure, toggle) → member.checked_in|out + CheckIn doc + member.checkedInAt, one transaction
```

- **Reuses** the v1.10 `on-command-created` trigger and the `lib/commands.ts`
  client writer pattern — the same shape as `attendance.mark`. Adding `checkIn.record`
  is one dispatch branch + one client function.
- **Idempotency:** `commandId` is the doc id and the idempotency key (Doc 4 §370). The
  trigger applies at most once; a redelivery hits a member whose state already matches
  and is a no-op (mirrors `attendance.mark`).
- **`occurredAt`** is the scan time, clamped (`clampOccurredAt`, shipped v1.10) — an
  offline scan replays honestly.

**Actor = the receptionist** (non-negotiable #5). Even a QR scan is reception-
responsible in v1.15; the QR is an *input method*, not a principal.

---

## 6. QR flow

A member is identified by a **QR code**. Two sub-questions (D1, D2):

- **What the QR encodes (D1).** The member's opaque `memberId` (a prefixed ULID — not
  PII, not enumerable). The scan yields `memberId` → the command targets it. The QR is
  therefore **deterministic and stable** from the member's id: "regenerate" means
  re-render / re-print the same code, not rotate it. (A rotatable `checkInToken` stays
  a clean seam if QR leakage ever becomes a threat.)
- **The member's QR card** lives in **Member Workspace → Kişisel (Personal) tab**:
  - **auto-generated** from `memberId` (client-side, self-contained — no external call,
    CSP-safe),
  - **regenerable** (re-render on demand — stable, since it is `memberId`-based),
  - **printable** (a print-friendly card the member can carry).
- **Who scans (D2).** Reception scans the member's QR with the device camera. This is
  reception-operated → fully Phase-1. A member-facing self-scan kiosk is Phase 2.

**UX target (UX-9):** a scan is one action; occupancy updates immediately (optimistic,
reconciled from the trigger's write, like attendance).

---

## 7. UI flows

**Reception Check-in screen (`/checkin`)** — desktop dense, mobile card/agenda. Two
equal inputs, side by side (never scanner-only):
- **QR tarama:** a camera scanner. Scanning a member → one-tap check in/out (the toggle
  shows the correct verb from `checkedInAt`).
- **Üye Ara:** a name/phone member search (the DEBT-001 cached list). **When the QR
  cannot be read**, reception finds the member by name/phone and does a manual
  check-in/check-out from the same screen. Both inputs converge on the identical
  `checkIn.record` command (`method: 'qr'` for a scan, `'reception'` for a manual pick).
- **Live occupancy:** *"Şu an içeride: 23"* per branch, from the `/checkIns` read.
- **Currently-inside list:** members with `checkedInAt != null`, with duration; a
  one-tap manual check-out.
- **Expected-but-absent (D6, simple):** *"3 yaklaşan üye giriş yapmadı"* — reservations
  starting within 15 min with no `member.checked_in` today.
- **Branch open/close (D3):** a "Şubeyi Aç / Kapat" control; occupancy is meaningful
  only while the branch is open.

**Member Workspace → Kişisel tab:** the member's **QR card** (auto-generated,
regenerable, printable) + a check-in history section.

**Mobile-first (UX-2):** the whole flow works at 375px; the scanner is the primary
control, search is the fallback. Single Workspace (UX-1): check-in completes on one
screen.

---

## 8. Technical design

- **New `checkin` module** (`packages/core/src/modules/checkin`): `CheckIn` type,
  `decideCheckIn(ctx, member-state, input) → events` (pure toggle, idempotent),
  `events.ts`, application `recordCheckIn` (used by the trigger), infrastructure repo
  (`/checkIns` + member state write), golden fixtures.
- **`apps/functions`:** add the `checkIn.record` branch to `on-command-created`
  (dispatch table). If auto-check-out is in scope (D4), add a scheduled
  `auto-check-out` sweep (`system` actor), ordered independently of the nightly
  attendance/expiry sweep.
- **`apps/web`:** `lib/commands.ts` gains `checkInCommand`; a `/checkin` route
  (server read of occupancy + currently-inside; client scanner + toggle); the member
  workspace shows the QR.
- **Occupancy read (`checkin-query.ts`):** query `/checkIns` for the branch since the
  day boundary (or `branch.opened`), fold in − out. Bounded and indexed; **not** a
  projection (those are Phase 2).
- **QR:** generate a QR image from `memberId` (or token) client-side; scan via a
  camera library (self-contained, no external calls — CSP-safe).

**Reused, not built:** the command envelope + `on-command-created` trigger + client
command writer (v1.10), `clampOccurredAt`, the members read/cache (DEBT-001), the
Sheet/table/card design-system patterns.

---

## 9. Decisions — RESOLVED

| # | Decision | Resolution |
|---|---|---|
| **D1** | What the QR encodes. | **`memberId`** (opaque ULID, not PII/enumerable). A rotatable `checkInToken` stays a clean future seam if QR leakage ever becomes a threat. |
| **D2** | Reception-scan only vs member self-scan kiosk. | **Reception-operated only** (actor = receptionist). Kiosk / member self-service → Phase 2 (needs the member portal). |
| **D3** | Occupancy day boundary. | **`branch.opened` / `branch.closed`** — reception opens/closes the branch; occupancy resets at close (Doc 2 §9 model). |
| **D4** | Auto-check-out (OQ-9). | **Yes — a nightly `system` sweep at 4 h.** Threshold is policy data (the code never knows the number). |
| **D5** | Direction model. | **Toggle** — a scan flips in/out from `checkedInAt` (fewest taps, UX-9). Reception may force a manual check-out from the inside-list. |
| **D6** | "Expected but absent" rule. | **Ship a simple version** in v1.15 (reservations starting within 15 min with no `member.checked_in` today). |
| **D7** | `method` for a reception-scanned QR. | **`'qr'`** — `method` records the *input*, `actor` records *who is responsible*. |

---

## 10. What this milestone deliberately does not do

- No occupancy **projection** (`projections/` is Phase 2) — occupancy is a bounded read.
- No **member self-service** / kiosk / member auth (Phase 2 portal).
- No turnstile / door hardware, no notifications, no payment.
- No new **event types** — the five above are already in the Doc 4 catalogue.

**Next step:** the owner reviews §9, we lock the decisions, and only then does
implementation begin (feature recipe: `checkin` events → golden → decider → tests →
application → trigger dispatch → occupancy read → UI).
