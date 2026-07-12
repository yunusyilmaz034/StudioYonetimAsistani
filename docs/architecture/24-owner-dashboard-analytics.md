# 24 — Owner Dashboard & Analytics (v1.23)

**Status:** **APPROVED** (owner, 2026-07-13). The five business definitions are decided — §9.
**Date:** 2026-07-13
**Milestone:** v1.23 — D24 dashboard · D25 analytics · D26 member timeline · D27 package timeline ·
D28 global activity feed · D29 the dashboard read model

**The milestone writes no business rule.** Not one event type, not one aggregate, not one new
decision function. It reads what v1.22 already records and turns it into something a person can run
a business on. If a screen in this milestone ever wants to *change* something, that is a defect in
the design, not a missing feature.

---

## 1. The one thing that must be decided first

The owner's constraints are, in order:

1. *Dashboard tek sorguda açılmalı. N+1 sorgu istemiyorum.*
2. *Migration yok. Backfill yok.*
3. *Projection gerekiyorsa yalnızca read model oluştur.*

These are in tension, and the tension is worth naming out loud, because the wrong resolution is the
kind of thing that is discovered eighteen months later.

**Counting cannot be done on read.** "Bugünkü rezervasyon" is a count over the day's events. Today
that is a few hundred rows and a query answers instantly. At three studios and two years it is
hundreds of thousands, and a dashboard that scans them is a screen that gets slower every single day
it succeeds. **A counter that is incremented once, when the event is written, never gets slower.**

**So: yes, a projection — and it is the first one in the system.** Doc 5 reserved projections for
Phase 2 precisely so we would not build one before we had a reason. We now have the reason, in the
owner's own words. Two rules make it safe, and they are the rules that make a projection *disposable*
rather than a second source of truth:

- **A projector reads events and nothing else.** Never a state document. The moment a projector
  reads `/members` to decide a number, the number can no longer be rebuilt from the log, and the
  projection stops being disposable — it becomes a database you cannot recover.
- **Every projection is rebuildable from the log, by script, at any time.** `pnpm projections:rebuild`
  replays `/events` into the read model from scratch. **This is not a backfill and not a migration:**
  it touches no historical data, invents nothing, and can be run a hundred times with the same
  result. It is what "projections are disposable" *means*. If the projection is ever wrong, we delete
  it and rebuild — an option no aggregate ever gives us.

**And one honest correction to "tek sorgu".** The dashboard cannot be a single document read, and
pretending otherwise would cost correctness. Half of what the owner asked for is **not an event
count** — it is a question about *state right now*:

| Widget | What it really is |
|---|---|
| Bugünkü check-in / rezervasyon / iptal / satış / tahsilat | **counters** — accumulate as events are written |
| Günlük doluluk oranı, saat/eğitmen yoğunluğu | **counters** |
| Yaklaşan üyelik bitişleri · Kredisi azalan üyeler · Bekleme listesi · Bugün boş kalan seanslar · Aktif üye sayısı | **live state** — these change with the *passage of time*, with no event at all. A membership expires because it is Thursday. |

A counter cannot answer "whose package expires in seven days", because nothing happened. Denormalising
those lists into the projection would mean writing them on a schedule and serving the owner a number
that is quietly stale — the exact failure mode the dashboard exists to prevent.

**The design, therefore:** **1 projection read + 5 bounded, indexed state queries, all fired in
parallel.** That is 6 round trips for the whole screen, fixed — it does not grow with the number of
members, reservations or events. **There is no N+1 anywhere:** no query is issued per row. (An N+1 is
"one query per member in a list"; we have none. Six parallel reads is not an N+1, it is a screen.)

---

## 2. The read models

Two documents. Both are `/studios/{sid}/readModels/…`, both are rebuildable, both are written **only**
by the projector.

### 2.1 `readModels/daily/{YYYY-MM-DD}` — the day's counters (D24, D25, D29)

One document per studio-local day. Written incrementally by `onEventCreated`. It is the whole of the
dashboard's numbers **and** the whole of analytics — the charts are just N of these documents.

```ts
interface DailyReadModel {
  date: string                      // 'YYYY-MM-DD' studio-local
  // ── the counts the dashboard shows
  bookings: number
  cancellations: number             // cancelled + late_cancelled
  moves: number
  checkIns: number
  attended: number
  noShow: number
  autoResolved: number
  waitlistJoined: number
  waitlistPromoted: number
  newMembers: number
  // ── money, in kuruş, integer (#10)
  salesKurus: number                // what was SOLD  (entitlement.purchased → priceAgreed)
  collectedKurus: number            // what was COLLECTED (entitlement.payment_recorded → amount)
  // ── the shapes the charts need, denormalised at write time
  byHour: Record<string, number>    // '09' → 7   (bookings per hour of the session)
  byTrainer: Record<string, number> // trainerId → sessions taught  ← id only, never a name (#6)
  byProduct: Record<string, number> // productId → packages sold    ← id only
  // ── occupancy: two integers, one ratio. Written by the schedule's own events.
  capacity: number                  // seats offered by today's non-cancelled sessions
  booked: number                    // seats taken
}
```

Every field is a **monotonic counter over events** — nothing here is a snapshot of state, which is
what makes the rebuild exact. Names are never stored: `byTrainer` holds ids, and the screen joins
`/staff` at render (the same batched join the Operations Center already does).

### 2.2 `readModels/dashboard/live` — deliberately **not built**

There is no "current state" projection, on purpose. Expiries, low credits, the waiting list and
today's empty classes are read from the state collections they already live in, through indexes that
already exist or are one line to add. A projection of them would be a cache with no invalidation
event — it would go stale on the stroke of midnight and nobody would know.

---

## 3. The projector

`apps/functions/src/projections/daily.ts`, dispatched from the existing `onEventCreated` trigger
(the second dispatch entry; Phase 1 has one, `member.stats`).

- **Pure mapping, then one transaction.** `(event) → increments` is a pure function, table-driven,
  unit-testable without an emulator. The transaction applies the increments to the day document.
- **Idempotent, because the trigger is at-least-once.** Firestore may deliver the same event twice.
  A double-counted booking is a silently wrong dashboard, which is worse than a broken one. Each
  application writes a marker `readModels/daily/{date}/applied/{eventId}` **in the same transaction**
  as the increment; a redelivery finds the marker and does nothing. (Cost: one extra small write per
  event. Correctness over cost — the priority order is not negotiable.)
- **`occurredAt` decides the day, never `recordedAt`.** An offline check-in that happened at 21:50
  and arrived at 08:10 belongs to yesterday's numbers. The event carries both timestamps precisely so
  this is a choice and not an accident (#3).
- **The projector reads no state document.** If a number needs the session's capacity, that number
  comes from `class_session.scheduled`'s payload, not from the session doc.

**Rebuild:** `tools/projections/rebuild.ts` — stream `/events` in `occurredAt` order, apply the same
pure mapping, write the day docs. Manual, never in CI, never deployed. Same input, same output.

---

## 4. Which screen reads which event

| Screen / widget | Source |
|---|---|
| Bugünkü check-in | `daily.checkIns` ← `member.checked_in` |
| Bugünkü rezervasyon | `daily.bookings` ← `reservation.booked` |
| Bugünkü iptal | `daily.cancellations` ← `reservation.cancelled`, `.late_cancelled` |
| Bugünkü satış | `daily.salesKurus` ← `entitlement.purchased` (priceAgreed) |
| Bugünkü tahsilat | `daily.collectedKurus` ← `entitlement.payment_recorded` (amount) |
| Günlük doluluk | `daily.booked / daily.capacity` ← `class_session.scheduled`, `.cancelled`, `.capacity_changed`, `reservation.booked`, `.cancelled` |
| Son 24 saat aktiviteleri | the v1.22 feed query (`/events`, `recordedAt desc`) |
| Aktif üye sayısı | **state** — `/members` where `status == active` (a count query, 1 read) |
| Yaklaşan üyelik bitişleri | **state** — `/entitlements` where `status == active`, `validUntil <= now+14d`, ordered |
| Kredisi azalan üyeler | **state** — `/entitlements` where `status == active`, `creditsAvailable <= 2` *(needs a denormalised `creditsAvailable` — see OQ-4)* |
| Bekleme listesi | **state** — `/waitlistEntries` where `status == waiting` |
| Bugün boş kalan seanslar | **state** — today's `/classSessions`, `bookedCount == 0` (or below a threshold) |
| Yaklaşan tatil operasyonları | **state** — `/studioCalendar` (D23) + planned `/studioClosures` |
| Günlük rezervasyon / iptal / check-in trendi | N × `daily` docs (30 reads for a month) |
| Haftalık doluluk · saat · eğitmen · paket dağılımı | the same N × `daily` docs — `byHour`, `byTrainer`, `byProduct` |
| D26 Üye timeline · D27 paket timeline · D28 global feed | `/events`, through the v1.22 query layer (unchanged) |

**No number on any screen is maintained by hand.** Every one is either a counter over events or a
query over state that the domain already owns.

---

## 5. Widgets — the shape, and why it is this shape

The owner asked for widget thinking *because the AI Studio Manager will consume the same widgets*
(v1.30). So a widget is not a React component with a chart in it; it is a **contract**, and the
component is one of its two renderers.

```ts
interface Widget<T> {
  id: string                                   // 'today.bookings'
  title: string                                // 'Bugünkü rezervasyon'
  kind: 'metric' | 'list' | 'chart'
  load(ctx: TenantContext, range: DateRange): Promise<T>   // the ONLY data path
  present(data: T): { headline: string; detail?: string; tone: Tone }  // human sentence
  render(data: T): ReactNode                   // the screen
}
```

`present()` is the seam that matters. It returns the widget's meaning **as a sentence** — the same
discipline as v1.22's event presenter, and for the same reason. When the AI Studio Manager arrives it
does not screen-scrape a chart: it calls `load()` and reads `present()`. *"Bugün 14 rezervasyon, 3
iptal; doluluk %62 — geçen haftanın aynı gününe göre 11 puan düşük."* A widget that can only draw
itself is a widget the AI cannot use.

The registry (`lib/widgets/registry.ts`) is a list. The dashboard renders the list. Nothing in the
dashboard knows what a widget contains.

---

## 6. Filters

One `DateRange` type, one place: `Bugün · Dün · Son 7 Gün · Son 30 Gün · Tarih Aralığı`. Plus
`personel · üye · paket · işlem tipi` on the feed and the timelines.

Every filter is applied **on the server**, in the Server Action — the client sends a range and a set
of ids, never a query. (OQ-1 from Doc 23 stands: the client never touches `/events`.)

**Search (D28), and the one thing it may not do.** *Üye adı* and *telefon* are searched against
`/members` **first**, producing a `memberId`; only then is the log queried by that id. The log cannot
be searched by phone number — **there are no phone numbers in it** (#6), and there never will be.
*OperationId* is searched directly, because that is an id. This is a design property, not a
limitation: it is the same property that lets us erase a member and keep her history as anonymous
behaviour.

---

## 7. Read budget

| Screen | Reads |
|---|---|
| Dashboard | **6** — 1 daily doc + 5 parallel bounded state queries. Fixed; independent of studio size. |
| Analytics, 30 days | **30** daily docs (a single ranged query on the `daily` collection). |
| Feed / timelines | unchanged from v1.22: 1 event query + 1 batched name read. |

The cost of the projector: **2 small writes per event** (the counter, the idempotency marker). At a
busy studio's ~500 events/day that is 1,000 writes — noise against the reservation traffic that
produced them.

---

## 8. What this milestone does NOT do

- **No new event type. No aggregate change. No migration. No backfill.** (The owner's rule, and it
  is the right one — everything below is achievable without touching a single historical byte.)
- **No business rule.** The dashboard never decides anything. It cannot cancel, extend, promote or
  adjust. It links to the screen that can.
- **No live listener.** `/events` stays owner-only in the rules; screens are served by Server Actions
  (Doc 23, OQ-1).
- **No AI.** Phase 1 ships zero AI. The widget contract is the *seam* — `present()` — and nothing
  more is built.

---

## 9. The five business definitions — LOCKED (owner, 2026-07-13)

These decide what the numbers *mean*. They are the owner's, and they are now binding.

**D-1 — Satış ≠ tahsilat.**
- **Satış** = the agreed total at the moment a package/subscription is created (`entitlement.purchased`
  → `priceAgreed`). Counted **even if unpaid**.
- **Tahsilat** = the sum of recorded payments (`entitlement.payment_recorded` → `amount`).
- **Açık bakiye** = satış − tahsilat.
Three separate widgets. A cancelled or reversed sale must be reflected **net** in the figures —
while its history is never deleted (#9: a correction is a compensating event, never an erasure).

**D-2 — Aktif üye.** Member record active **AND** at least one valid, active package: not
not-yet-started, not expired, not cancelled, not frozen. A member with an active record and no valid
package is a **contact, not a customer**, and is not counted. Shown beside it, as its own metric:
**son 30 günde katılan yeni üyeler**.

**D-3 — Doluluk.** `toplam booked / toplam capacity` — **summed over sessions, then divided.** Never
the average of per-session percentages (that lets a single 1/1 PT slot outweigh a 3/20 group class).
Cancelled sessions and cancelled reservations are excluded. Sessions with capacity ≤ 0 are excluded
so they cannot distort the ratio. PT and group appear together in the headline, **with a category
breakdown beside it** (grup · PT · fitness).

**D-4 — Kredisi azalan üye.** Default threshold **≤ 2**, but **never hard-coded**: it lives in studio
settings (`policy` / studio config), like every other number in this system (#4 — nothing in the code
knows the number six, and nothing will know the number two). The list contains only packages that
are: active · still within validity · **credit-based** · `remaining ≤ threshold` · `remaining > 0`.
**Zero-credit packages get their own list** ("Kredisi bitenler"). Unlimited and period-based packages
are excluded entirely — they have no credits to run low.
*Denormalisation, approved:* `creditsAvailable` on the entitlement, written **in the same transaction**
as the ledger movement. **The ledger remains the source of truth**; the field is a queryable mirror and
enters the denormalisation register (Doc 3 §6) with a rebuild path.

**D-5 — Boş kalan ders.** Not cancelled · 0 reservations · starts in the future · **within the next 24
hours**. The widget is named "Önümüzdeki 24 saatte boş kalan dersler". 48-hour and 7-day filters are
available; distant empty classes stay **out of the alarm** — an empty class tomorrow is not yet news,
an empty class at 18:00 today is a phone call reception can still make.

**Cross-cutting (owner):** every dashboard metric is computed in **studio timezone**; "bugün" is the
calendar day **00:00:00–23:59:59**. Analytics must never slow the dashboard's first paint — charts
load lazily, separately. The dashboard writes nothing and decides nothing.

---

## 10. Sequencing

1. **The projector + the rebuild script** (D29) — pure mapping, unit tests, idempotency, rebuild.
2. **The widget contract + registry** (`load` / `present` / `render`).
3. **D24 Owner Dashboard** — the twelve widgets over the read model + the five state queries.
4. **D25 Analytics** — the charts, entirely from `daily` docs. No new query path.
5. **D26 / D27** — the member and package timelines deepened (sub-tabs, the package's lifecycle
   strip); the v1.22 query layer is reused unchanged.
6. **D28 Global feed** — search (member → id → log; OperationId direct) and the full filter set.

---

## 10.1 As built — three deviations from §2, and why

1. **Occupancy is NOT a counter.** It is computed from the sessions themselves (`bookedCount` /
   `capacity`), because a session's booked count is maintained *transactionally* by the booking path
   and is therefore authoritative — and because a class cancelled after it was booked changes the
   ratio with no event that a counter could fold cleanly. The sessions of a day are a bounded,
   indexed read the dashboard already makes. Same for the hour and trainer breakdowns in analytics.
   The projection keeps only what is genuinely a fold: bookings, cancellations, moves, check-ins,
   attendance, sales, collections, new members, waitlist.

2. **`entitlement.cancelled` gained two additive payload fields** (`priceAgreed`, `productId`). The
   owner's D-1 requires the revenue figure to go NET when a sale is reversed, and a projector may
   read only events — without the amount *in the event*, the figure could not be un-sold without
   giving the projection a second source of truth. Additive: no version bump, no upcaster, no
   backfill. A cancellation written before v1.23 carries no amount and is simply not subtracted
   (I-30: we do not guess).

3. **Money is an object in the log** (`{ amount, currency }`, #10). The first draft of the projector
   read `payload.priceAgreed` as a number and would have reported **zero revenue forever** — silently,
   without crashing. Caught by a unit test before it ever ran. It is the reason `kurus()` exists.

---

## 11. Risks

| Risk | Mitigation |
|---|---|
| The projection drifts from the log (a missed event, a double count) | Idempotency markers; and a `pnpm projections:verify` that recomputes a day from the log and diffs it against the stored doc. A projection you cannot audit is a second source of truth. |
| The trigger fails silently and the dashboard quietly shows yesterday | The day document stores `lastEventAt`; the dashboard shows a "veriler gecikiyor" banner if it lags the newest event by more than a few minutes. A wrong number must be loud. |
| A projector reading a state document | Enforced by dependency-cruiser (Doc 5's existing rule) |
| Analytics tempting a business rule | The dashboard has no write path at all — no Server Action in this milestone mutates anything |
