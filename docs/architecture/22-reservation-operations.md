# 22 — Reservation Operations · Architecture (v1.22)

> **Status: DECISIONS LOCKED (owner, 2026-07-13). Architecture only — no code has been written.**
>
> The milestone where the studio stops doing things **one at a time**. Until now every operation
> moved a single reservation, a single credit, a single session. v1.22 is about **operations that
> move many of them at once, safely** — a holiday that cancels a week, a package extension across
> every affected member, a recurring booking that creates eight reservations in one act.
>
> Bulk operations are where an event-sourced system either proves itself or quietly corrupts a
> ledger. The difference is entirely in the design, so the design came first.
>
> **Six open questions were put to the owner and all six are answered (§10). This document now
> records decisions, not options.**

---

## 0. Before anything else — a live defect that v1.22 would industrialise

**Cancelling a class today does not cancel its reservations, and the nightly sweep then burns the
members' credits for a class that never happened.**

The chain, in current code:

1. `cancelSession` writes the session document and one `class_session.cancelled` event.
   **It does not touch the reservations** (`scheduling/application/session.ts`).
2. The reservations stay `booked`, pointing at a session that will never run.
3. `sweepAutoResolve` selects **every** booked reservation whose `sessionEndsAt` has passed
   (`listResolvableBooked` filters on `status == 'booked'` and the end time — nothing else).
4. `decideAutoResolution` checks the *reservation's* status and the grace window. **It never
   checks whether the SESSION was cancelled.** It applies `policy.attendanceDefaultOutcome`,
   which in this studio is `attended` → `creditEffect: 'consumed'`.

So: the studio cancels tonight's class, does nothing else, and tomorrow morning every member who
was booked into it has **lost a credit for a class the studio itself cancelled**.

The domain *knows* the right answer and states it in the other path — `decideCancellation`
honours **I-14**: a studio-cancelled class always releases the hold, window or no window. But
that path only runs if a human cancels each reservation by hand. Nothing makes them.

**Why this blocks the milestone rather than being a footnote:** D21 is precisely *"cancel a week
of classes and refund the credits"*. Building it on top of this would take a bug that currently
costs one class and run it across hundreds of reservations, on the owner's command, in one click.

### The fix — Step 0, before anything else is built

- **I-27 (new invariant):** *a booked reservation on a **cancelled** session is never
  auto-resolved.* The sweep **releases** it — `reservation.cancelled`, `creditEffect: 'released'`,
  actor `system`, source `system_sweep`. It never presumes attendance at a class that did not
  happen.
- `decideAutoResolution` gains the guard. It already receives the session; it simply has to look
  at it.

**Rejected alternative:** make `cancelSession` cancel every reservation eagerly. It is the obvious
move and it is wrong *on its own*: a cancellation with 60 reservations needs writes across 60
aggregates plus their entitlements (~180 writes — past Firestore's 500-per-transaction ceiling
once a class is large), and it does nothing for reservations already stranded by past
cancellations. **The sweep guard is the correctness fix**; an eager cascade is an optimisation we
may add later, in batches, *because* the guard makes it safe to be late.

### What about reservations that were ALREADY burned? — OQ-6, decided

**No backfill. No history rewrite. And no silent correction.**

A closure (D21) that encounters a session whose reservations are **already resolved** — `attended`,
`no_show`, or otherwise closed — **refuses to process that session**:

- The session is **blocked** from the bulk operation.
- The inconsistency is **reported in the preview**, by name and count.
- The owner fixes it with the **existing correction flow** (`reservation.corrected` — a
  compensating event with a mandatory reason, actor = the human who decided).
- Then the bulk operation is re-run, and the session is no longer blocked.

**Why not auto-correct?** Because a correction moves a credit and needs a reason, and neither is
the system's to invent. The rule that follows is worth stating plainly:

> **The system never manufactures a credit that was really lost, and never silently edits a past
> event. It refuses, reports, and waits for a human with a reason.**

---

## 1. The event-sourcing analysis — the answer, capability by capability

| | Capability | New aggregate | New events | Version bump | Migration | Backfill |
|---|---|---|---|---|---|---|
| **D18** | Recurring reservations | **No** | **No** | **No** | No | No |
| **D19** | Reservation move | No | **1** — `reservation.moved` | **No** | No | No |
| **D20** | Waiting list | No — extends `Reservation` | **2** (+2 reserved, unused) | **No** | No | No |
| **D21** | Holiday / closure ops | **Yes** — `StudioClosure` | **3** + reuse | **No** | No | No |
| **D22** | Bulk package ops | **Yes** — `BulkOperation` | **2** + reuse | **No** | No | No |
| **D23** | Studio calendar | **Yes** — `StudioCalendarDay` | **4** | **No** | No | No |

**Nothing in v1.22 requires a migration, a backfill, or a version bump.** That is not luck — it is
the payoff from v1.21's rule: *snapshots live in state, event payloads stay minimal*. Every new
capability is **additive**: new event *types* (AD-52 permits them without migration) and new
*state* fields that read as absent on existing documents.

The one thing that would have broken it: putting `seriesId` into the `reservation.booked` payload.
§2 explains why we will not.

---

## 2. D18 — Recurring / Series Reservations *(decided)*

> *"Pazartesi 19:00 + Çarşamba 19:00, 4 hafta."*

### It is not a new aggregate. It is a generator.

The owner's own rule decides the architecture: **"her rezervasyon bağımsızdır."** Each occurrence
is an ordinary `Reservation`, held, cancelled, moved and resolved by rules that already exist. A
"recurring reservation" is therefore **not a thing that exists in the domain** — it is an *act*
that produces N things that do. The precedent is in the codebase already: *"Bu haftayı tekrarla"*
(`duplicate-week.ts`) is an application-layer generator with a pure planner and no aggregate.

```
computeSeriesPlan(pattern, existingSessions, entitlements, now, policy)   ← PURE
    → { toBook[], skipped: [{ date, reason }] }
applySeries → N × the EXISTING bookReservation use-case, one per transaction
```

### **D18.1 — The system never invents a session.**

A recurrence **books into sessions that already exist on the calendar**. If the studio has not
scheduled a class for Wednesday 19:00, that date is **reported as `no_session`** — it is never
"helpfully" created, and no phantom reservation is written against a class that does not exist.
Creating classes is scheduling's job and the owner's decision; booking is a different act.

### **D18.2 — Partial success, with nothing skipped silently.**

The preview is mandatory, and every date lands in exactly one bucket. **No date may be dropped
without a name for why:**

| Bucket | Meaning |
|---|---|
| `toBook` | will be created |
| `no_session` | no class exists on the calendar at that day/time |
| `full` | the session is at capacity |
| `already_booked` | she already has a reservation for it (I-9.6) |
| `beyond_validity` | the session starts after her package expires (I-9.4) |
| `insufficient_credit` | the package runs out partway through the series (I-9.5) |
| `not_eligible` | category / service / PT-ownership wall (I-9.7, I-9.8, I-9.9) |

The owner (or member) approves the plan; then the bookable ones are created. **A failure on one
occurrence never blocks the others** — each is its own transaction.

*Worked example (the owner's):* Mon+Wed 19:00 × 4 weeks = 8 target dates. The calendar holds only
6 real sessions → **6 reservations created, 2 reported as `no_session`.**

### **D18.3 — The series is bound by `correlationId`, not by a payload field.**

- **In the log:** one `correlationId` for the whole act. The envelope already carries it on every
  event. *"These six bookings were one act"* is already expressible — nothing has needed it until
  now.
- **In state:** an optional `seriesId` on the reservation document (absent on every existing
  reservation, which is exactly right — they belong to no series). It exists so a future *"cancel
  the rest of the series"* is a query, not a scan.

**We will NOT add `seriesId` to the `reservation.booked` payload.** That would be a version bump
and a permanent upcaster on the most frequent event in the system, bought for nothing.

**Credits are held, not consumed** — six bookings on an 8-credit package take *available* to 2
immediately. The preview must show that, because reception will be asked about it.

---

## 3. D19 — Reservation Move *(decided)*

### Why not cancel-and-rebook — and it is not a performance argument

Two events (`cancelled` + `booked`) in one transaction would produce the right *state* and a
**false history**: the log would say she quit the class and joined another. Six months later, when
the owner asks *"how many people cancel on us?"* — the churn signal, the reason the event log
exists — **every move in the studio's history would be counted as a cancellation.**

**A move is a distinct business fact and gets a distinct event: `reservation.moved`.**
Payload: `{ fromSessionId, toSessionId, creditEffect, hoursBeforeOriginalStart, override, reason }`.

> **D19.1 — In every report and metric, a move is a move. It is never counted as a cancellation.**

### **D19.2 — The free-move window IS the free-cancellation window.**

- Outside the window → the member may move freely, from the portal.
- **Inside the window → the portal refuses.** A free move inside the window would defeat the
  window entirely: move to any class, then cancel *that* one outside *its* window, and the late-
  cancellation rule evaporates by a rename.
- The window is read from the **session's stamped snapshot** (D14) — never re-derived, never a
  hard-coded 6.

### **D19.3 — Reception/owner may override, with a reason, and the log says so.**

A member genuinely ill at 17:00 for a 19:00 class is a real case, and the answer is a human one:
staff can move her anyway. The override is **not a silent superpower** —
`reservation.moved` carries `override: true`, the **reason**, the **actor**, and both session ids.
Accountability, not prevention.

### **D19.4 — The credit is the real design.**

The reservation holds a credit **against a specific entitlement**. Moving may or may not keep it
valid:

| Case | The domain does |
|---|---|
| The **same** entitlement still covers the target (service, category, validity, PT ownership) | **Nothing moves in the ledger.** The hold stays held. `creditEffect: 'none'` — no entitlement event at all. The common case, and the cheapest. |
| The same entitlement is **no longer eligible**, but **another** is | **Release** on A, **hold** on B, in the same transaction (two ledger events). The reservation's `entitlementId` changes. |
| No eligible entitlement for the target | **Refuse** (`no_bookable_entitlement`). A move is not a licence to bypass the walls. |

**Every wall re-runs** — category (I-9.7), service (I-9.8), PT ownership (I-9.9), capacity,
double-booking, target-not-started. Eligibility is **re-decided**, never "carried over": otherwise
a Reformer booking could be moved into a Mat class her package never covered.

### **D19.5 — One transaction.**

Reservation + both sessions' `bookedCount` + up to two entitlements + events. ~8 writes: safely
inside the transaction limit, and it must be atomic — a move that half-lands is a member in two
classes or none.

---

## 4. D20 — Waiting List *(decided — no notification, so no automation)*

### The aggregate already exists (and so do two of the event names)

`ReservationStatus` already contains **`waitlisted`**, and Doc 04 already reserves
`reservation.waitlisted` and `reservation.promoted` as Phase-2 names. The seam was left open on
purpose. A waitlist entry is a `Reservation` with:

- `status: 'waitlisted'`
- **`creditEffect: 'none'`** — **I-29: a waitlist entry holds NO credit.** Holding one would punish
  her for hoping: her balance would be frozen for a class she may never get into.
- FIFO from `waitlistedAt` — a stored *position* is a number that can drift out of agreement with
  the timestamps that produced it.

### **D20.1 — No automatic promotion. A human decides.**

The owner's ruling, and it is the right one for the channels we actually have:

```
class full → member joins            → reservation.waitlisted   (no credit held)
seat frees (cancel / move away)      → the STAFF screen surfaces: "Yer açıldı — sıradaki: Elif Ş."
staff promotes her (after a call)    → reservation.promoted     (NOW a credit is held; the walls re-run)
```

**We will NOT auto-book the next member.** Without SMS/push she would discover a booking she never
asked for — and, if she does not come, the presumption rule (DEBT-007) would consume her credit.
Auto-promotion without a notification channel is a way to charge people for classes they never
knew about.

**And we will NOT build the offer/TTL flow yet.** An offer that expires in 30 minutes is invisible
to a member who has no notification — the seat would rot down the list while the class runs empty.

### **D20.2 — The domain is shaped so offer/TTL is additive later.**

- The names `reservation.offered` and `reservation.offer_expired` **stay reserved and unused**,
  exactly as `reservation.waitlisted` has been since day one.
- Promotion is already a **separate act** from the seat freeing — so inserting an offer step
  between them later changes no existing event and no existing state.
- What a future channel adds: an `offerExpiresAt` on the entry, a minute-scale scheduled sweep,
  and the two reserved events. **No migration, then or now.**

Member-side: she sees her **position** in the queue and her status. Staff-side: the freed-seat
alert, with the FIFO order.

**Promotion is one transaction:** reservation → `booked`, hold the credit, increment
`bookedCount`, write events. It re-runs every wall — a package that expired while she waited does
not get in.

---

## 5. D21 — Holiday / Closure Operations *(decided)*

> Admin picks 19–26 July → the system produces an analysis → **on approval**: cancel, refund,
> extend.

**This is the most dangerous operation in the product.** It cancels classes, releases
money-adjacent credits, and extends package validity — in one act, on one click. So it is designed
the way a migration is designed: **preview, approve, apply, and never twice.**

### A new aggregate: `StudioClosure`

Not because the operations are new, but because **the decision needs an identity**: a thing the
owner declares, previews, approves, and can point at forever ("what did we do in July?").

```
StudioClosure
  id, dateFrom, dateTo, reason
  calendarDayIds[]                      ← the D23 days this closure realises
  scope: { kind: 'studio' | 'category' | 'service' | 'product' | 'members',  ids[] }
  extensionDays: number | 0             ← CHOSEN by the owner, not derived (D21.3)
  status: 'planned' | 'applying' | 'applied' | 'cancelled'
  blocked: [{ sessionId, reason }]      ← inconsistencies that must be fixed first (OQ-6)
  summary: { sessionsCancelled, reservationsReleased, creditsReleased, membersAffected,
             entitlementsExtended, frozenSkipped, blockedSessions }
  appliedAt, appliedBy
```

> **I-28 — a bulk act (`StudioClosure`, `BulkOperation`) is applied AT MOST ONCE.** `status` is the
> guard; re-application is **refused, not repeated**. Without it, a double-click extends every
> package by six days instead of three, and nothing in the ledger can tell you which happened.

### **D21.1 — Scope is chosen, not assumed.**

The owner picks: **whole studio · category · service · product · selected members**. A closure of
the Pilates room is not a closure of the studio, and extending a fitness member's package for it
would be a gift she did not earn — and a number the owner cannot explain later.

### **D21.2 — Only packages whose validity OVERLAPS the closure are extended.**

A package that expired before the closure, or starts after it, was not harmed by it. This is the
fair reading *and* the smaller, safer write.

### **D21.3 — The extension length is the owner's choice, not an automatic derivation.**

Five days closed may mean +5, or +7 (a courtesy), or none. The system **proposes** the closure's
day-count and the owner **decides**. A number this consequential is not derived behind her back.

### **D21.4 — Frozen entitlements are never touched.** *(OQ-5)*

They appear in the preview as their own group — *"Dondurulmuş olduğu için işlenmedi (N)"* — and the
owner may handle them later, deliberately, with a reason. Freeze arithmetic is explicitly unbuilt
(**DEBT-009**); extending a frozen package would be doing freeze arithmetic by the back door, and
this milestone will not redesign it by accident.

### **D21.5 — Sessions with already-resolved reservations are BLOCKED.** *(OQ-6)*

Reported, not processed, not corrected. See §0.

### Events

- `studio_closure.planned` — the range, scope and analysis were fixed.
- `studio_closure.applied` — the summary, once, for the log and the future dashboard.
- `studio_closure.cancelled` — a planned closure abandoned.
- Per affected object, the **existing** events, all carrying the closure's `correlationId`:
  - `class_session.cancelled` (existing)
  - `reservation.cancelled` with `creditEffect: 'released'` — **I-14 already guarantees this.** D21
    needs no new refund rule; it needs the rule that already exists to actually run (§0).
  - **`entitlement.extended` (new)** — `{ days, fromValidUntil, toValidUntil, reason, closureId }`.

**Why `entitlement.extended` and not the existing `entitlement.amended`?** An amendment is *"a
human edited this subscription"*. An extension is *"the studio was closed and owed her time
back."* They will be counted differently — and once they are the same event, they can never be
separated again.

**Who is the actor?** The **owner** — a human declared and approved this. `system` is for the
sweeps nobody asked for. *(Non-negotiable #5.)*

---

## 6. D22 — Bulk Package Operations *(decided)*

Structurally D21 minus the cancellations, and it shares the machinery.

- **New aggregate: `BulkOperation`** — id, filter/scope, preview summary, `status`, counts,
  `appliedAt`, `appliedBy`, `reason`, `note`. Same reason as `StudioClosure`: **a bulk act needs an
  identity and an idempotency guard** (I-28). *"+1 credit to every Pilates member"* run twice is an
  expensive, invisible mistake.
- **New events:** `bulk_operation.planned`, `bulk_operation.applied` (the summary). Per
  entitlement, the **existing** `entitlement.adjusted` (credits) or the new `entitlement.extended`
  (days) — all sharing the operation's `correlationId`.
- **Nothing new in the ledger.** `decideAdjust` already enforces **AD-39**: a closed-enum `reason`
  (`gift | correction | migration | support`) **and** a non-empty note, and a decrease that would
  go below zero is **refused, never clamped**. A bulk operation is a hundred of those, not a new
  kind of arithmetic. The reason and note are given once, for the batch, and stamped on every one.
- **Frozen entitlements: skipped and reported**, exactly as in D21.4.

**The preview is not a nicety.** *"127 üye · 143 paket · 3 dondurulmuş (işlenmedi)"* must be on
screen **before** the button, because after it there is no undo — only a compensating bulk
operation, which is a different, visible act.

---

## 7. D23 — Studio Calendar *(decided — manual + an external holiday source)*

### The distinction the whole module rests on

> **"Resmî tatil" is a fact about the calendar. "Stüdyo kapalı" is a reversible owner decision.
> A holiday record NEVER cancels a session, releases a reservation, or extends a package.**

### The aggregate

```
StudioCalendarDay
  id
  dateFrom, dateTo                    ← a single day is from == to
  timeFrom?, timeTo?                  ← an intra-day closure ("14:00–18:00 bakım")
  type: closed enum (below)
  title, note
  branchIds[] | null                  ← null = the whole studio
  source: 'manual' | 'provider'
  providerRef?: { provider, externalId, importedAt }   ← provenance for imported days
```

**`type` is a closed enum**, for the same reason `Category` is: the schedule screen, the closure
flow and (Phase 2) the AI will branch on it, and a stringly-typed admin field would make every one
of those a guess.

```
'public_holiday' | 'public_holiday_half' | 'religious_holiday' |
'studio_closed'  | 'maintenance' | 'trainer_training' |
'special_event'  | 'special_working_day'
```

Events (additive, no bump): `studio_calendar.day_marked` · `.updated` · `.removed` ·
`studio_calendar.imported` *(a provider run: `{ provider, year, daysImported }` — provenance, not
content)*.

### **D23.1 — The external holiday provider is a PORT, not a dependency.**

```
interface HolidayProvider {                        ← the domain owns this shape
  listHolidays(country: string, year: number): Promise<ProviderHoliday[]>
}
```

- The domain depends on **the port**, never on a specific API. Swapping the source is an adapter
  change, not a domain change.
- **Imported days are SNAPSHOTTED into `StudioCalendarDay`.** The calendar is our record, not a
  live view of someone else's data.
- **If the provider later changes its answer, our history does not move.** A closure applied last
  July was applied against the calendar as it stood; nothing re-writes it. *(Same principle as the
  policy snapshot, D14, and the product snapshot, D12 — and for the same reason.)*
- Import is **never destructive**: it proposes days; the owner keeps her own edits. A re-import
  updates only `provider`-sourced days that have not been realised by a closure.
- **Half-days** (`public_holiday_half`) and **time-ranged closures** are first-class. A morning
  class on a half-day is fine; an evening one may not be — which is exactly why the calendar
  informs rather than decides.

### **D23.2 — The Class Calendar shows it, calmly, and never by colour alone.**

- Month/week/day: a **quiet background tint** on the day plus an explicit **label/icon** — *"Resmî
  Tatil"*, *"Stüdyo Kapalı"*. Colour never carries meaning alone (Doc 09 §7).
- It must **not collide with the `today` and `selected-day` treatments** the owner approved in
  v1.20. Those are the strongest marks on the screen and stay that way; the calendar day type is a
  *background* fact, not a *focus* one.

### **D23.3 — Creating a session on a marked day is warned, never blocked.**

| Day type | On "create session" |
|---|---|
| Holiday / half-day / special | *"Bu tarih Resmî Tatil olarak işaretli. Yine de seans oluşturmak istiyor musunuz?"* → confirm → created normally. |
| **`studio_closed`** | A **stronger** warning: *"Stüdyo bu tarihte kapalı olarak işaretlenmiş. Seans oluşturmak kapanış planıyla çelişiyor. Yine de devam etmek istiyor musunuz?"* → owner may still proceed. |

**The acceptance of a warning is not an event.** It is a UI act, not a business fact. But *"this
session sits on a holiday"* must remain **derivable** afterwards — and it is: session date ⋈
calendar day. **No new field on `ClassSession`, no new event.** A denormalised flag would be a
second source of truth that drifts the moment the calendar is edited.

### **D23.4 — Week-duplication and series generation must show holidays, and let the owner choose.**

- Holidays and special days landing in the range are **shown in the preview**, marked.
- **Holidays are NOT auto-skipped by default** — the owner chooses *include* or *skip*.
- **`studio_closed` days ARE skipped by default** — the owner may explicitly override.

The asymmetry is deliberate: a public holiday is a fact about the country (the studio may well
open); a closed day is a statement the studio already made about itself, and generating classes
into it should take a deliberate act.

### **D23.5 — The line between D23 and D21 that must never be crossed**

| | D23 — Calendar | D21 — Closure Operation |
|---|---|---|
| What it does | **writes information** | **cancels, refunds, extends** |
| Reversible? | yes — edit or remove the day | **no** — only a compensating act |
| Can it fire the other? | **only by an explicit owner action**: *"Bu kapanış için etki analizi oluştur"* | — |
| Automatic destructive behaviour | **none, ever** | none — preview + approve |

Marking a day closed **surfaces a suggestion** ("Bu gün için 12 seans planlı — Tatil İşlemi
başlat?"). It opens D21's **preview**. The owner still approves. **The calendar feeds the closure;
it never fires it.** If marking a day could cancel classes by itself, a typo in a date field would
refund the studio's July.

---

## 8. The model, consolidated

### New aggregates (3)

| Aggregate | Why it exists | Idempotency |
|---|---|---|
| `StudioCalendarDay` | Days have meaning the whole system branches on. | — (a plain record) |
| `StudioClosure` | A destructive decision needs an identity, a preview and an audit. | **`status`** (I-28) |
| `BulkOperation` | Same, for credit/day grants across many members. | **`status`** (I-28) |

### New state fields (all optional; absence is meaningful, never a gap)

| Field | On | Absent means |
|---|---|---|
| `seriesId` | `Reservation` | not part of a recurrence |
| `waitlistedAt` | `Reservation` | not a waitlist entry |
| `extendedDays` / `extensions[]` | `Entitlement` | never extended |

### Events — the full list

| Event | Aggregate | New? |
|---|---|---|
| `reservation.moved` | reservation | **new** |
| `reservation.waitlisted` | reservation | **new** (name reserved in Doc 04) |
| `reservation.promoted` | reservation | **new** (name reserved in Doc 04) |
| `reservation.offered`, `reservation.offer_expired` | reservation | **reserved, NOT built** (D20.2) |
| `entitlement.extended` | entitlement | **new** |
| `studio_closure.planned` / `.applied` / `.cancelled` | studio_closure | **new** |
| `bulk_operation.planned` / `.applied` | bulk_operation | **new** |
| `studio_calendar.day_marked` / `.updated` / `.removed` / `.imported` | studio_calendar | **new** |
| `class_session.cancelled`, `reservation.cancelled`, `reservation.booked`, `entitlement.adjusted`, `entitlement.credit_*` | — | **existing, reused unchanged** |

**Zero payload changes. Zero version bumps. Zero upcasters. Zero migrations. Zero backfills.**

### New invariants

- **I-27** — a booked reservation on a **cancelled** session is never auto-resolved; it is
  released.
- **I-28** — a bulk act is applied **at most once**; `status` is the guard.
- **I-29** — a waitlist entry holds **no** credit. A credit is held only at promotion.

### Transaction & idempotency boundaries

| Operation | Transaction boundary | Idempotency |
|---|---|---|
| **Series (D18)** | **One transaction per occurrence** (N independent). Partial success is the design. | Each booking is guarded by `already_booked` (I-9.6). Re-running a plan books only what is missing. |
| **Move (D19)** | **ONE transaction** — reservation + both sessions' counts + ≤2 entitlements + events (~8 writes). | Natural: a moved reservation is no longer on the source session. |
| **Waitlist join / promote (D20)** | One transaction each. Promotion holds the credit and increments the count atomically. | Promotion re-checks `status === 'waitlisted'` inside the transaction: two staff clicking at once, one wins. |
| **Closure (D21)** | **NOT one transaction** — a week's closure is ~40 sessions / ~300 reservations / ~120 entitlements ≈ well past the 500-write ceiling. **Per-object transactions**, each still atomic *with its events* (#1 preserved where it means something), driven by a **resumable worker**; the closure document is the progress ledger (`status: 'applying'` + per-phase counters). A failure at object 300 of 400 **resumes**; it does not restart. | **I-28** — `status` refuses a second apply. |
| **Bulk (D22)** | Same shape as D21. | **I-28.** |
| **Calendar (D23)** | Single-document transaction. | Import is upsert-by `providerRef`. |

### Dry-run / preview model — one shape for all of them

```
preview(scope, now) → {
  buckets: { [reason: string]: Item[] },   // EVERY affected object is in exactly one bucket
  summary: { counts, credits, members },
  blocked: [{ id, reason }]                // must be fixed by a human before apply
}
```

Three rules, and they are the same three every time:

1. **Nothing is skipped without a name.** A silent skip is a lie told by omission.
2. **The preview writes nothing.** It is a pure function over a read.
3. **Apply RE-DERIVES; it never replays the preview.** Between preview and apply, reception may
   have booked someone into a class the closure is about to cancel. **The preview is a promise
   about shape, never about exact counts** — and the summary the owner sees afterwards is the
   *applied* one, not the *previewed* one.

---

## 9. Sequencing *(owner-approved)*

| # | Step | Why here |
|---|---|---|
| **0** | **I-27 — the cancelled-session fix** (+ the "already burned" query, reported not corrected) | D21 industrialises the bug otherwise. Nothing may start first. |
| **1** | **D23 — Studio Calendar** (+ the holiday provider port) | The smallest aggregate and D21's input. Ships value alone: the owner can see her year. |
| **2** | **D21 — Holiday / Closure Operations** | Highest value, highest risk. Built on a fixed cancellation path and a real calendar. |
| **3** | **D22 — Bulk Package Operations** | Shares D21's preview/apply/idempotency machinery; mostly reuse. |
| **4** | **D19 — Reservation Move** | Self-contained; one new event; no orchestration. |
| **5** | **D18 — Recurring Reservations** | A pure generator over an unchanged booking path. |
| **6** | **D20 — Waiting List** | Last; FIFO + manual promotion, with offer/TTL as a designed-for extension point. |

---

## 10. The six questions — RESOLVED (owner, 2026-07-13)

| | Decision |
|---|---|
| **OQ-1 → D18.1/D18.2** | **Partial success, with a mandatory preview and no silent skips.** Seven named buckets. The system **never invents a session** for a date with no class. |
| **OQ-2 → D19.2/D19.3** | **The free-move window IS the free-cancellation window.** Inside it, the portal **refuses**. Staff may **override with a reason**, recorded on `reservation.moved` (actor, reason, from, to). A move is **never counted as a cancellation** in reports. |
| **OQ-3 → D20.1/D20.2** | **FIFO list, NO automatic promotion.** A freed seat raises a **staff alert**; a human promotes. The member sees her position. **Offer/TTL is designed for and not built** — the event names stay reserved. |
| **OQ-4 → D21.1–D21.3** | Extend **only packages whose validity overlaps the closure**. **Scope is selectable** (studio / category / service / product / members). **The extension length is the owner's choice**, not derived. Preview mandatory. |
| **OQ-5 → D21.4** | **Frozen packages are never touched** — reported as their own group. DEBT-009's freeze arithmetic is not redesigned by accident. |
| **OQ-6 → §0** | **No backfill, no history rewrite, no silent correction.** A session with already-resolved reservations is **blocked**, reported, corrected by a human through the existing correction flow, then the operation is re-run. |

**Owner decisions still pending: none.** The milestone is fully specified.

---

## 11. Risks

- **Step 0 is the milestone's foundation.** If the sweep guard is wrong, D21 refunds the wrong
  people — or refunds nobody and consumes everybody.
- **Bulk writes exceed a transaction.** The closure/bulk workers must be resumable and idempotent,
  or a failure at object 300 of 400 leaves the studio in a state nobody can describe. `status` is
  not decoration; it is the recovery story.
- **Preview drift.** The world moves between preview and apply. Apply re-derives; the preview
  promises shape, not counts.
- **No notification channel.** It is why D20 is manual (D20.1) and why members learn about a
  closure refund by opening the app. It bounds what this milestone can honestly promise.
- **The provider is someone else's data.** Snapshot it, never trust it live, and never let a
  re-import move a closure that has already been applied (D23.1).
