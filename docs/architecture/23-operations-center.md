# 23 — Operations Center (v1.22, second half)

**Status:** **APPROVED and BUILT** (owner, 2026-07-13). OQ-1, OQ-2 and OQ-3 are decided (§9).
**Date:** 2026-07-13
**Milestone:** v1.22 *Operasyon Motoru* — the Scheduling Engine (D18–D23) shipped; this is the
other half of the same milestone.

---

## 1. What this is, and what it is not

> **Six screens, one source of truth: the event log.**

The owner's framing is binding and it changes the design: *"Bu ekranlar sadece rapor değil;
resepsiyonun ödeme, üyelik ve operasyon takibini yapacağı ana çalışma ekranları olacak."*

A report is something you open at month-end. A **working screen** is open all day, it is the first
place reception looks when a member says *"ben bunu iptal etmiştim"*, and it must answer that
question in seconds, with a timestamp, a name, and a reason. That is a different product with a
different budget: bounded queries, one round trip, no scanning.

**It is not a projection.** Projections are Phase 2 (Doc 5). Nothing in this milestone builds a
derived read model, a materialised view, or a trigger that writes one. Every screen here is a
**bounded query over `/events`** — which is exactly what an append-only, indexed, correlated log is
for. If a screen ever needs more than one query to render, that is the signal that a projection is
finally justified; not before. *(Priority order: Simplicity > Performance, until measured.)*

**It is the substrate for v1.28 Undo / Time Machine.** Every row this milestone renders already
carries the three things undo needs: the `OperationId` (what else did this act do?), the
`UndoPolicy` (can this be undone, and how — OP-4), and the two timestamps. The screens are built so
that adding an "Undo" button in v1.28 is a button, not an archaeology project.

---

## 2. The one architectural claim

**The event log already IS the read model for these six screens.** Sixty-seven event types, ULID
ids (time-ordered), `related.{memberId, entitlementId, classSessionId, reservationId}` as the
join-key set, `correlationId` as the OperationId (OP-2), `actor` as the principal, and two
timestamps. Everything the owner asked for is in there — the log was designed for this day.

What is missing is not data. It is three things:

1. **Indexes.** Five composite indexes (§5). Without them these queries either fail or scan.
2. **A presenter.** One place that turns `('entitlement.credit_released', payload)` into
   *"1 kredi iade edildi"*. Sixty-seven types, one file, exhaustive over the catalogue — a new
   event type that forgets its Turkish sentence must be a **build failure**, not an empty row.
3. **Names.** Events carry **no PII** (#6, I-13) — deliberately, permanently. `memberId` is an
   opaque id. So every screen joins the log against `/members` and `/staff` at render time, in a
   batched read. *This is not a workaround; it is the design working as intended.* Identity lives
   in `/members`, behaviour lives in events, and that separation is what makes KVKK erasure
   possible at all: erase the member, and the log survives as anonymous behaviour.

---

## 3. The six screens

Each is a query, a presenter and a list. Nothing more.

| # | Screen | Route | Query | Who |
|---|---|---|---|---|
| 1 | **Activity Feed** (Hareket Merkezi) | `/activity` + dashboard widget | `orderBy(recordedAt desc) limit 50` + filters | staff |
| 2 | **Member Timeline** | Member Workspace → *Geçmiş* tab | `related.memberId == m` | staff |
| 3 | **Reservation Timeline** | Session Workspace → roster row → drawer | `related.reservationId == r` | staff |
| 4 | **Package Timeline** | Member Workspace → package card → drawer | `related.entitlementId == e` | staff |
| 5 | **Operations History** | `/operations` (exists) + `/operations/[id]` | aggregate row + `correlationId == op` | owner |
| 6 | **Audit Log** | `/audit` | `type in AUDIT_TYPES`, `orderBy(recordedAt desc)` | **owner only** *(owner, 2026-07-13)* |

**3.1 Activity Feed.** The live stream: reservation · cancellation · move · waitlist · check-in ·
payment · membership · package · bulk operation · system. Filters: **kind** (a closed enum of
groups, not 67 checkboxes), **actor**, **member**, **date range**, and a free-text search over the
member name (resolved client-side against the batch we already fetched — the log has no names to
search). Default: today, newest first.

**3.2 Member Timeline.** *"Bir üyenin sisteme girdiği ilk andan itibaren tüm geçmişi."* Registration,
invitation, portal activation, every purchase, every credit movement, every booking, every
cancellation, every check-in, every correction. It is the answer to every dispute a studio ever has.

**3.3 Reservation Timeline.** `booked → moved → moved → cancelled`, or
`waitlist.joined → waitlist.promoted → booked → attended`. Note that a **move is one event**
(D19) — the timeline shows a journey, not a fake cancellation, precisely because the write path
refused to lie about it.

**3.4 Package Timeline.** `purchased → credit_held ×n → credit_consumed ×n → extended → frozen →
unfrozen → expired`, with the running `available` after each move (the payloads already carry
`creditsAvailableAfter` — AD-19: every event records the post-state of every number it changed).
The credit ledger becomes legible without a single new field.

**3.5 Operations History.** One row per operation: **OperationId · reason · who · started · finished
· affected counts · outcome**. Drill in → every event that carries that `correlationId`, i.e. the
40 session cancellations, the 300 credit releases and the 120 extensions that were **one act**.
This is OP-2 paying for itself.

**3.6 Audit Log.** Owner only. *Kim, ne yaptı, ne zaman, eski değer, yeni değer, OperationId.*
A filtered view of the same log over the types that change the world by human decision —
corrections, credit adjustments, price/product edits, policy publications, closures, bulk acts,
member deactivation. See §6 for before/after.

---

## 4. The read model, in one type

```ts
// The ONE shape every screen renders. Built in the Server Action, never in the browser.
export interface ActivityEntry {
  readonly eventId: string
  readonly type: string            // 'reservation.moved'
  readonly kind: ActivityKind      // 'reservation' | 'credit' | 'payment' | 'membership' |
                                   // 'checkin' | 'operation' | 'schedule' | 'system'
  readonly occurredAt: number      // domain time  ─┐ OP-1: both are shown, to the second
  readonly recordedAt: number      // server time  ─┘ (they differ for offline commands)
  readonly actor: { type: string; id: string; name: string }   // name resolved from /staff
  readonly member: { id: string; name: string } | null         // resolved from /members
  readonly title: string           // 'Rezervasyon taşındı'          ← presenter
  readonly detail: string          // 'Salı 09:00 → Perşembe 18:30'   ← presenter
  readonly reason: string | null   // OP-3 — a bulk act's reason, a correction's reason
  readonly operationId: string     // OP-2 — the correlationId
  readonly undoPolicy: UndoPolicy  // OP-4 — 'compensating' | 'irreversible' | 'informational'
  readonly changes: readonly FieldChange[]  // §6 — [] when the event predates OP-1..5
  readonly related: { reservationId?: string; entitlementId?: string; classSessionId?: string }
}
```

**Invariant I-30 (new).** *A screen never invents a fact the log does not have.* If an old event
carries no before/after, the Audit Log shows `—` and says so. It never reconstructs a plausible
past. A log that guesses is worse than a log with gaps, because you cannot tell which rows are
guesses.

---

## 5. Queries, indexes, budget

Five composite indexes on `/studios/{sid}/events` (`firestore/firestore.indexes.json`):

| Query | Index |
|---|---|
| Activity Feed | `recordedAt desc` *(single-field; automatic)* |
| Feed filtered by kind | `type ASC, recordedAt DESC` |
| Member Timeline | `related.memberId ASC, occurredAt DESC` |
| Reservation Timeline | `related.reservationId ASC, occurredAt DESC` |
| Package Timeline | `related.entitlementId ASC, occurredAt DESC` |
| Operation detail | `correlationId ASC, occurredAt ASC` |

**Read budget.** Every screen: **1 event query + 1 batched name read** (members and staff by id,
`getAll`, deduplicated). A page of 50 rows referencing 12 distinct members costs 2 round trips, not
51. Pagination is cursor-based (`startAfter` on the ULID `id` — time-ordered, so it doubles as the
cursor). `collectionGroup()` remains forbidden; every query is studio-scoped through `TenantContext`.

**Cost of being wrong here:** an unbounded feed query on a studio with 200k events is a bill, not a
bug report. Every query in this milestone carries an explicit `limit`, and the Server Action — not
the caller — sets it.

---

## 6. Before / after (Audit Log) — OQ-2

The owner asked for *eski değer / yeni değer*. Today's events carry a **delta plus the post-state of
every number they changed** (AD-19), which yields before/after for the credit ledger for free — but
not for a name edit, a price change or a capacity change.

**Recommended:** an **additive, optional `changes` array inside the payload** of state-editing
events, written from now on:

```ts
type FieldChange = { readonly field: string; readonly from: unknown; readonly to: unknown }
// e.g. product.updated → changes: [{ field: 'listPrice', from: 420000, to: 450000 }]
```

Why the payload and not the envelope: the envelope is the one structure that must never move
(AD-42); a payload gains an optional field **additively**, with no version bump, no upcaster and no
migration. Absent ⇒ `[]`.

**What cannot be done, and will not be pretended:** history cannot be backfilled. Events written
before today have no `changes`, and no amount of engineering will produce one — the before-value
was never recorded. The Audit Log will render those rows with `—` and a one-line explanation. This
is I-30, and it is the honest answer.

---

## 7. What this milestone does NOT build

- **No projections.** (Phase 2. If a query gets slow, that is the trigger — measured, not feared.)
- **No Undo button.** (v1.28. The model is ready — OP-4 — the button is not.)
- **No real-time listener.** The feed refreshes on navigation and on a manual refresh. A live
  `onSnapshot` on `/events` would require opening the log to the client SDK, which OQ-1 declines.
- **No new write path.** Not one event type is added. Not one aggregate. This half of the milestone
  writes **nothing**; it only reads. That is what makes it safe to build fast.
- **No payment aggregate.** Payment events (`entitlement.payment_recorded`) render in the feed and
  the timelines today; the real Payments module stays where the roadmap put it.

---

## 8. Sequencing

1. **Indexes + the query layer** (`server/activity-query.ts`) — the five queries, the batched name
   resolver, the cursor.
2. **The presenter** (`lib/activity/present.ts`) — 67 types → Turkish title/detail/kind/tone,
   exhaustive: a missing case fails the build.
3. **Activity Feed** (`/activity`) + the dashboard widget.
4. **Member Timeline** + **Package Timeline** (both live in the Member Workspace — UX-1).
5. **Reservation Timeline** (Session Workspace roster → drawer).
6. **Operations History detail** (`/operations/[id]`), incl. `startedAt`/`finishedAt` on the
   operation aggregates (additive state fields).
7. **Audit Log** (`/audit`, owner) + `changes[]` on the state-editing events.

---

## 9. Open questions — the owner's call

**OQ-1 — Who may read the event log, and how?** ✅ **Answered (owner, 2026-07-13): the rule does
not move.** `/events` stays owner-only in Firestore; every screen is fed by a Server Action and the
role filter runs on the server. **Reception never reads a raw event.**
*The recommendation, as accepted:* **keep the Firestore rule as it is** (`/events` readable by `owner` only through
the client SDK) and serve every screen through **Server Actions**, which apply the role filter
server-side. Reception gets the operational event kinds; the owner gets everything plus the Audit
Log. The client never reads `/events` directly.
*Rejected alternative:* opening `/events` to `receptionist` in the rules. It buys a live listener
and one less round trip, and it costs a real widening of the blast radius — every payload, every
correction, every note, readable by every reception device, with the filtering left in the browser.

**OQ-2 — Before/after in the Audit Log?** ✅ **Answered (owner, 2026-07-13): additive `changes[]`,
from now on; no guessing for old records.**
*As accepted:* additive `changes[]` inside the payload of state-editing events, from now on;
`—` for history, honestly labelled (§6, I-30).

**OQ-3 — Audit Log visibility.** ✅ **Answered (owner, 2026-07-13): owner only.**

---

## 9.1 One thing the owner's rule could NOT have, and why

`changes[]` is **not** written for `member.profile_updated`. A member's profile fields ARE the PII
— name, phone, birth date — and recording their before/after would put PII into the event log. That
is non-negotiable #6, and it is unrecoverable: it is the single thing that makes KVKK erasure
possible at all. The Audit Log therefore shows **which fields** a profile edit touched, never their
values. The values live in `/members`, where they can be erased.

Everything else the owner asked for is delivered as asked: price edits, product edits, capacity
changes, policy publications and credit movements all carry before → after.

---

## 10. Risks

| Risk | Mitigation |
|---|---|
| The presenter drifts from the catalogue (a new event renders as a blank row) | The presenter is a `Record<EventType, Presenter>` typed over the catalogue union — a missing entry is a typecheck error, not an empty row |
| An unbounded feed query on a large studio | Every query has a server-set `limit` + a cursor; no client-supplied page size |
| A name that no longer exists (an erased member) | The resolver returns `Silinmiş üye` — the log survives erasure by design (#6) |
| The Audit Log becomes a place to *edit* history | It is read-only, forever. There is no write path in this half of the milestone. Corrections remain compensating events (#9) |
