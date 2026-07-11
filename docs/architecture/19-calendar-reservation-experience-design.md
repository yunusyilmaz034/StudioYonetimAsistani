# 19 — Calendars & Session Workspace · Design (v1.19)

> **Status: IMPLEMENTED (v1.19). Shared calendar engine + Class Calendar + Reservation
> Calendar + tabbed Session Workspace (info · reservations · attendance · notes, two new
> note events) + "Bu haftayı tekrarla" (app-layer, room+time conflict) + global
> navigation. Attendance marking depends on the Functions trigger — deferred (DEBT-011,
> repay in v1.24). Member portal split to v1.20/v1.21.**
>
> **Scope split (owner):** v1.19 delivers the **two calendars + Session Workspace +
> "duplicate this week" + global navigation**. The **member portal + member auth** moved
> to **v1.20** (its own milestone, own design doc — Doc 20). This doc's §7 is a forward
> reference only.
>
> The studio's two most-used operations screens — the **Class Calendar** (Ders Ajandası)
> and the **Reservation Calendar** (Rezervasyon Ajandası) — on **one shared calendar
> base**, reusing the existing booking / attendance / scheduling actions. The only new
> domain surface is the two owner-approved **note events** (§10). Everything else is
> UI + application over existing primitives.
>
> **Resolved decisions (§11):** split ✓ · member-auth = invite-link/set-password → v1.20 ✓
> · week-duplication = app-layer, conflict key = same room + start time, no new domain
> rule ✓ · notes = Ders Notu (session) + Hızlı Not (reservation), two new events ✓.

This design is grounded in the owner's old-system reference (BulutGym): dense month
cells, member names in the reservation calendar, a "+N etkinlik" day popover, and an
in-calendar Session Workspace (Ders Bilgileri · Rezervasyonlar · Yoklama · Notlar). We
match the **information density, layout, and interaction model** — not the pixels.

---

## 1. Boundaries & what already exists

| Surface | Today (v1.12/v1.13/v1.17) | v1.19 adds |
|---|---|---|
| `/schedule` Class Calendar | Month/Week/Day/Agenda, filters, session **Sheet** (single column: trainer/room/capacity/cancel + booking roster) | Tabbed **Session Workspace**, interactive **+N popover**, **attendance** tab, **notes**, "duplicate this week" |
| `/reservations` Reservation Calendar | Day/Week/Agenda (no Month), reservation-first, member names, cancel | **Month view**, dense member-name cells, +N popover, **shared base** with `/schedule` |
| Member portal | **does not exist** — members cannot log in | **member login + self-service reservations** (new) |
| Global navigation | **does not exist** — screens are standalone routes | persistent nav shell (priority 4) |

**Reuse confirmed (research):** all four calendar views, `MonthGrid`/`DayList`, date/tz
helpers, `passesFilters`, `FilterSelect`, occupancy display, and the session Sheet with
booking roster already live in `schedule-screen.tsx`. `/reservations` **duplicates** every
helper — the concrete case for extracting a shared base. The "+N" **count** exists
(`schedule-screen.tsx:314`) but is inert text, not a popover.

**Priority order (owner):** 1) Class Calendar · 2) Reservation Calendar · 3) Member
reservation experience · 4) Global navigation · 5) other UI-review fixes. Sections below
follow this.

## 2. Shared calendar base — extract once, use twice

Extract `apps/web/src/components/calendar/` from the duplicated `/schedule` + `/reservations`
machinery:

- **View engine:** Month grid · Week · Day · Agenda; date navigation; studio-local
  `dayKey`/`time`/`shift`/`mondayIndex` helpers (today copied in both screens).
- **Dense day cell:** ordered list of session/reservation "chips"; overflow → **"+N
  etkinlik"**.
- **+N day popover:** a wide, readable **day panel over the calendar** (not a route
  change) listing every item for that day — the missing interactive piece.
- **`FilterSelect`** and the occupancy/late-window display.

Both calendars render the same base with a different **item renderer** (a class chip vs. a
reservation-with-member-name chip) and a different data feed. **No new core read** — the
base is pure presentation over data the queries already return.

## 3. A — Class Calendar (Ders Ajandası) · `/schedule`

**Desktop month view:** Month/Week/Day/Agenda switch (exists). Each day cell lists that
day's sessions **time-ordered**; each chip shows **time · service · occupancy
(booked/capacity)**, trainer when it fits, a status/occupancy colour. Overflow → **"+N
etkinlik"** → the shared day popover shows the full day.

**Session Workspace (in-calendar, replaces the single-column Sheet with tabs):** clicking a
session opens a workspace **without leaving the calendar** (Single Workspace, UX-1) —
desktop **tabs**, mobile **accordion/bottom-sheet**:

| Tab | Contents | Reuses |
|---|---|---|
| **Ders Bilgileri** | service, trainer, room, capacity, occupancy, status; change trainer/room/capacity, cancel (future-only, I-26) | existing session Sheet + `changeTrainer/Room/Capacity`, `cancelSession` |
| **Rezervasyonlar** | member search + add to session · roster list · cancel a reservation · occupancy/capacity | `listBookingMembersAction`, `getBookingStatusAction`, `bookReservationAction`, `getSessionRosterAction`, `cancelReservationAction` |
| **Yoklama** | one-tap attendance (attended / no-show) per booked member; correction with reason | `markAttendanceCommand` (⚠ offline `/commands` — needs the Functions trigger), `correctReservationAction` |
| **Notlar** | class note (Ders Notu) — see §11-D (new field/event, **decision**) | — |

Reservations, attendance, capacity and notes are all managed **in this one workspace** —
no page hops (owner requirement).

## 4. B — Reservation Calendar (Rezervasyon Ajandası) · `/reservations`

Same shared base, **reservation-first** and **denser**:

- Adds a **Month view** (today only day/week/agenda). Each day cell shows sessions with
  **member names inside** (the old-system density), occupancy, status colour; overflow →
  "+N etkinlik" → day popover with every reservation.
- Clicking a session opens the **same Session Workspace** (§3) — add member, cancel,
  attendance, note — no separate page. **One workspace, shared between both calendars** —
  not two divergent UXs (owner requirement).
- Keeps the existing member/trainer/service/status filters.

**Data:** the existing **two-read join** (`listBySessionStartRange` + `listSessionsForDay`,
joined by `classSessionId`) already returns reservations with `memberSnapshot.displayName`
— **no new core read** for dense member-name rendering (`reservations-workspace-query.ts`
already does exactly this).

## 5. C — Mobile

Desktop density does not shrink into an unusable month grid. Mobile (verified 375 · 430 ·
768):

- **Default view: Day / Agenda** (month is desktop-dense; mobile leads with the day).
- Date navigation; **session cards** with time · service · trainer · occupancy.
- Tap a card → Session Workspace as **accordion / bottom-sheet** — reservation list, add,
  cancel, attendance, note, all **one-tap**.
- Same capability as desktop; only the presentation differs (UX-2/7).

## 6. "Duplicate this week" (session-week duplication)

A real operations flow on top of the single-session/template tools:

1. Owner prepares a week normally on the calendar.
2. "**Bu haftayı tekrarla**" → choose **4 / 8 weeks / until a date**.
3. Every session in the source week is copied to the following weeks, preserving **day,
   time, service, trainer, room, duration, capacity**.
4. **No generation into the past.**
5. **Conflicts shown before saving; never a silent overwrite.**
6. A pre-flight **summary**: to-create · to-skip · conflicts.

**This is session-week duplication, not recurring member reservations.**

**Build shape (research):** the copy loop is **application-layer** — read the source week
(`listSessionsForDay`), re-create each future occurrence via `scheduleSession` /
`saveSessions`; skip-past is a trivial filter. **BUT** the domain has **zero conflict /
overwrite logic today** (`decideScheduleSession` checks only time-range, room-branch, room
-capacity; template idempotency `(templateId, startsAt)` does not apply to templateless
copies). So **"no silent overwrite" and any room/time-collision check are net-new** — see
**§11-C (decision)**: a new read (`listSessionsInRoomForRange` or a service+time key) plus
an application pre-check, or a genuine domain overlap guard.

## 7. Member / client reservation experience → **moved to v1.20 (Doc 20)**

Split out of v1.19 by owner decision so member authentication ships as its own milestone.
**Recorded for v1.20:** auth = **invite-link / one-time-code → set-password**, phone as
username, **no SMS dependency** (§11-A resolved as A1); it activates the `member`
principal, self-scoped Firestore rules, `allowMemberSelfBooking`, and `member.portal_login`
(§11-B). Members log in and see/book/cancel **their own** reservations and see their
credits — reusing `listByMember` / `selectEntitlement` / `bookReservation` /
`cancelReservation` behind a **member principal** and **self-scoped rules**. The seam (actor
type, policy field, reserved event, read) already exists; v1.20 wires the auth + rules. The
full member-portal design is **Doc 20**, written when we reach that milestone.

## 8. Routes, data sources, actions, new reads

**Routes:** `/schedule` (Class Calendar, evolved) · `/reservations` (Reservation Calendar,
+month) · `/portal/*` (member, new) · a shared nav shell (§9).

**Existing reads/actions reused (no change):**
- Scheduling: `listSessionsForDay`, `getSession`, `listServices/Rooms/Templates`;
  `scheduleSession`, `generateSessions`, `cancelSession`, `changeTrainer/Room/Capacity`.
- Booking: `bookReservationAction`, `cancelReservationAction`, `correctReservationAction`;
  `getSessionRosterAction`, `getBookingStatusAction`, `listBookingMembersAction`,
  `listUpcomingSessionsAction`.
- Reservations reads: `listBySessionStartRange`, `listBySession`, `listByMember`.
- Attendance marking: `markAttendanceCommand` (offline `/commands`, Functions trigger).

**New reads / seams (read-only unless a §11 decision says otherwise):**
- **Week-duplication conflict read** (§6/§11-C): `listSessionsInRoomForRange` (or a
  service+time key) for the no-overwrite pre-check.
- **Member self-scoped reads**: the same `listByMember` / entitlement reads, but behind a
  **member principal** and **self-scoped Firestore rules** (§11-A/B).
- **Session note** (§11-D): a new `ClassSession` field + event, if approved.

## 9. Carried UI-review findings (priority 4–5, tracked, not dropped)

From the owner review, kept in scope (lower priority than the top 3) or as follow-ups:
- **Persistent global navigation** (priority 4) — a nav shell across all screens
  (Genel Görünüm · Üyeler · Ders Ajandası · Rezervasyon Ajandası · Check-in · Paketler …).
- **`/packages` access** (Paketler / Üyelik Seçenekleri) reachable from the nav.
- **Member list active/passive filter**; **filter members by package category and by a
  specific package**.
- **Real Turkish names, never technical IDs** on screen (audit every id leak).
- **De-duplicate the repeated actions** atop the Member Workspace (v1.18 quick-action bar
  overlaps in-tab actions — the review flagged redundancy).
- **Dashboard / Reservation query consistency** check.

These do **not** dilute the top three; they are the §5 "other UI-review fixes" bucket.

## 10. Session & reservation notes (owner-approved — two new events)

The old system has a **Ders Notu** (class note, member-visible, "Herkese Açık") on the
session and a per-reservation **Hızlı Not**. Neither exists in core today. Owner approved
**both** (§11-D). Two new events (event schema is owner-owned — approved):

- **`class_session.note_set`** — sets/updates a `ClassSession.note` (`{ text, visibility:
  'staff' | 'members' }`). Member-visible notes surface in the member portal (v1.20). Actor:
  owner/receptionist. Correction = a new note_set (last-write, but the log keeps history —
  non-negotiable #9 is satisfied because each set is its own append-only event).
- **`reservation.note_set`** — a short staff note on one reservation
  (`Reservation.note: string`). Actor: owner/receptionist.

Both are **plain data + event**, no credit/validation logic — not a business rule. They
follow the feature recipe: event + golden fixture + pure decider + test + application +
UI. **PII caution (non-negotiable #6):** a note is free text on a state doc; the *event
payload* must not carry member PII — it carries the note text and ids only, and the note is
about the session/reservation, not a person. Reception is instructed (UI copy) not to type
identifying third-party data; this is the same standing rule as member `notes`.

## 11. Decisions — RESOLVED (owner, 2026-07-11)

**A — Member authentication method → A1 (deferred to v1.20).** **Invite-link /
one-time-code → set-password**, phone as username, **no SMS dependency**. Reception
generates a one-time link/code; the member opens it, sets a password; a member Auth
account is created (phone as username via a synthetic identifier or a custom token),
claims `{studioId, memberId, role:'member'}`; later logins = phone + password. Detailed in
Doc 20.

**B — Member principal seam & self-scoped rules → v1.20.** Activating member login (actor
construction, member branch in the claims/auth path, member-aware booking guards,
**self-scoped Firestore rules** — members read only `memberId == theirs`,
`allowMemberSelfBooking`, `member.portal_login`) is v1.20 scope. Doc 20.

**C — "Duplicate this week" → C1: app-layer, no new domain rule.** Conflict key = an active
`scheduled` session **already at the same room + same start time** (for a room-less session,
same service + start time). A new **read** (`listSessionsInRoomForRange` or equivalent) +
an **application pre-check** report **to-create / to-skip / conflict** and **never
overwrite**; skip anything not in the future. The domain still only creates sessions — **no
new invariant.**

**D — Notes → both.** **Ders Notu** (session, member-visible flag) **and** reservation
**Hızlı Not** — two new events (§10). Event schema owner-approved.

**E — Milestone scope → SPLIT.** v1.19 = **Calendars & Session Workspace** (shared base,
both calendars, +N popover, tabbed Session Workspace incl. notes, week-duplication, global
navigation). v1.20 = **Member Portal & Auth**. Payments → v1.21. Roadmap (Doc 10 §4)
updated.

## 12. Validation & risks

- Every milestone: `pnpm check` + `next build` green; responsive at 375 · 430 · 768 · 1280;
  reuse existing tests, add unit tests for any new read/decision.
- **Attendance in the Session Workspace needs the Functions emulator/trigger running** —
  marking is the offline `/commands` path, not a synchronous action.
- **No live runtime verification** without the emulator (now available — Java installed);
  member-auth + self-scoped rules especially must be exercised on the emulator.
- **No new business rule ships without an approved §11 decision.**
