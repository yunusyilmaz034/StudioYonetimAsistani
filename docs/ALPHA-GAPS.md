# Alpha Gaps — what the product promises and does not yet fully do

**This is not the debt register.** `docs/DEBT.md` records **deliberate shortcuts** — decisions taken
with eyes open, each with a trigger to repay. This file records something different and more
uncomfortable: **behaviour the user can already see, and that is not finished yet.**

The distinction matters because the two rot differently. A debt sits quietly and costs interest. A
half-finished behaviour **teaches the studio that the product is approximately true** — and that is a
loss you do not get back by shipping the missing half later.

Every entry here is on the way to zero. An entry that is still open when Alpha ends is a bug, not a
trade-off.

---

## The rule this file exists to enforce

> **A setting that does nothing is worse than a setting that is absent.**

We have refused this twice already and it was right both times:

- the **"Dondurma Hakkı"** field collected a number no operation could ever use (v1.27 · fixed by
  building freeze, S3);
- the **timezone picker** would have offered a choice five client components ignore (v1.27 S2 ·
  left read-only, honestly).

Where we ship it anyway, it is written down here, and the screen says so out loud.

---

## Open

**None.** Every gap opened during Product Alpha is closed. An entry that was still open when Alpha
ended would have been a bug, not a trade-off — and there is none.

---

## Closed

*(An entry moves here when the behaviour is complete. It stays visible: what we shipped half-done and
then finished is the most useful thing this file can teach.)*

### AG-1 — Working hours are stored, shown, and not enforced ✅ **CLOSED — v1.27, Alpha closure**

**Was open:** v1.27 S2 → v1.27 Alpha closure. The settings screen collected per-day opening hours, the
session form *warned*, and **the engine shrugged**: a class could be scheduled at 04:00 on a Sunday,
and a member could be booked into it.

**What closed it:**

- `checkWorkingHours` (`scheduling/domain/working-hours.ts`) — pure, 12 tests. A class must fit
  **entirely** inside the day's window: a 19:30 class in a studio that closes at 20:00 is a class
  whose second half nobody is there for.
- **Two gates, not one.** `decideScheduleSession` refuses a class that cannot exist; `decideBooking`
  and `decideMove` refuse a seat that cannot be taken. Booking is checked too because **hours
  change**: a studio that used to close at 22:00 still has last month's 21:30 classes on its
  calendar, and nobody should be able to put a new member into one of them.
- **The calendar wins.** `special_working_day` (D23) waives the weekly hours for that date — a
  make-up class on a Sunday, a workshop after closing. Working hours describe the *normal week*; the
  calendar describes *this date*, and the more specific statement wins. Without this, the studio's own
  "we are open" would have been unschedulable and reception would have gone back to paper.
- **Two refusals, in Turkish:** `studio_closed_on_day` and `outside_working_hours` — and the second
  one **says which hours it refused against**. "Kapalı saatte olamaz" leaves reception guessing.
- **The guard is REQUIRED, never optional.** `StudioHoursPort` is a mandatory dependency of every deps
  object that can create a class or take a seat. Forgetting it is a **compile error** — an optional
  guard is a guard one refactor away from being forgotten, and this one had already been forgotten
  once. Wiring it caught the **member portal** and the **waitlist promotion**, both of which book and
  neither of which anybody had thought about.
- **No event-schema change.** The golden fixtures are unchanged and prove it: this was a signature
  change, not a payload change.
