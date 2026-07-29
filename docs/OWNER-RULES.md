# Owner Rules — decisions that outlive the conversation they were made in

Standing decisions the owner has made that **cannot be derived from the code**. A fresh session, a
new machine, a different Claude account: this file is where these survive. Everything here was said
once, is binding until the owner says otherwise, and has cost something to learn.

Rules that ARE derivable from the code (invariants, the event model, the module boundaries) live in
`docs/architecture/`. Deliberate debt lives in `docs/DEBT.md`. This file is only for the things a
reader could not work out by looking.

---

## How we work

**OR-1 · Bug → hotfix, improvement → feature, straight to `main`.** (2026-07-18)
The pilot is live and the owner sends real-usage feedback constantly. Classify each item first: wrong
behaviour is a `fix(...)`, a new or better thing is a `feat(...)`. Small related fixes may share a
commit. Finish with commit + push. New ideas that are not being built now go to
`docs/PRODUCT-FEEDBACK.md` as `PF-nn`.

**OR-2 · Inside an approved scope, decide the small things yourself.** (2026-07-15, restated since)
When the owner has given a complete, approved specification, do not stop at every sub-decision —
event field names, test design, UI placement, file structure are yours. Commit and push in sensible
blocks rather than after every step.

**OR-3 · Stop for exactly three things.** An irreversible **event-schema** conflict, a real domain
conflict the existing invariants cannot settle, or anything touching **money or migration**. Nothing
else. Asking about the rest is slower, not safer.

**OR-4 · Say what you assumed.** When running autonomously, collect the decisions taken by default
and list them at the end as "what I took as accepted". The owner reads that list; it is how a fast
run stays reviewable.

---

## Product and UX

**OR-5 · Single Workspace.** A business object (member, reservation, staff, service, room, package)
is managed in ONE workspace: open it and everything about it is there and editable, with minimal
navigation and popups. Desktop uses tabs; mobile uses accordions/sheets **with no loss of
capability** — the same information and the same editing rights. A workspace is a *presentation*
layer: every in-place edit still goes command → decision → event. Canonically Doc 12 · UX-1.

**OR-6 · The redesign is a RE-COLOUR. Screen layouts do not change.** (2026-07-15, emphasised twice)
Apply the palette, typography and component style; do not invent new screens or rearrange existing
ones. **Calendar views are especially untouchable** — the month/week/day grid stays as it is. The
owner and Işıl are used to it and want it. A single-surface list "operations screen" for reservations
was built once and rejected: *"önceki gibi tasarım olsun, sadece renkler şimdiki gibi."*

**OR-7 · Premium, but operation first.** (2026-07-11) The bar is Apple / Linear / Stripe Dashboard /
Notion: calm, professional, trustworthy at first glance. No decorative effects. One design language
across every owner screen. The UI must make the work FASTER — fewer clicks — not merely prettier;
reception uses it eight to ten hours a day.

---

## Domain rules the owner has settled

**OR-8 · A hybrid (demet) is ONE sale + N entitlements.** One per component, each in its own
category, because the category wall means a pilates credit cannot open a fitness door. The whole
price sits on the PRIMARY component; the others are granted at zero — a priceless component is a
GRANT (`assignSubscription`), never a sale. The UI groups them by `productId` into **one card**, and
the active-package counter counts a hybrid **once**. When touching subscription code, preserve these
three: one sale + N entitlements, one card, one count.

**OR-9 · A package keeps its own size; a reduction is an opening balance.** (2026-07-28)
Selling an eight-class package with five credits does not make it a five-class package — it gives her
five of eight, and the screen says `5/8`. This is the migration case and it is normal: a member
coming off the old system arrives part-way through her package, sometimes with a backdated start.
A NEW member is always sold her package whole. Sale-time reductions are recorded with reason
`migration`, never `correction` — nobody made a mistake.

**OR-10 · The catalogue standard is for the DESK, never the member.** (2026-07-28)
"(normalde 8)" explains a reduced package to staff. To a member it reads as being short-changed, and
she cannot know it was her own history that shortened it. Asserted structurally in
`apps/web/src/app/shell-boundary.test.ts`.

**OR-11 · Reservations are coloured by PACKAGE, not by status.** (2026-07-28) Status is already on
the badge; the row's fill answers "which package paid for this". Our colour is exact — the
reservation has held a credit from a named entitlement since booking — where the studio's previous
system had to infer it from dates and warned that overlapping subscriptions break it.

**OR-12 · Freezing asks first.** (2026-07-28) A freeze stops a paid membership and moves its end
date; it is not a toggle. It requires a duration (enforced — the sweep resumes her on that day), a
reason from a closed list, and an optional free note. More days than her budget is **refused, never
clamped**. The reason enum is what makes freezes countable later; the note is prose for people and
lives on state so an erasure can reach it.

**OR-13 · The AI never gives the schedule.** (2026-07-27) Not availability, not occupancy, not "how
many places are left" — under any circumstance, including as an aside. It is not fenced with an
instruction; the data is simply never given to the model, because a model cannot leak what it was
never handed. Seats are held by a human who can see the room and the day.

---

**OR-17 · Deploy at night; the panel is the business during the day.** (2026-07-29) Every deploy
breaks whatever tab is already open — Next.js re-hashes its Server Action ids, and a page loaded
before the build can no longer save. On 2026-07-29 three pushes in ninety minutes cost reception a
member registration and a member her account activation; both were healthy, both tabs were stale.
So: **batch fixes and ship them after hours.** Something genuinely urgent still ships immediately —
that is the owner's call, not a reason to hesitate — but it is announced first so reception reloads
once instead of discovering it in front of a customer.

**OR-18 · Test accounts are excluded from the books, never deleted from the log.** (2026-07-29) The
studio's own people (Işıl ×2, Reyhan, Yunus) tried the system on live accounts: 36.040 ₺ of sales on
17 July and their reversal as −44.473 ₺ on 29 July, all arithmetically correct and operationally
meaningless. The events STAY — an event is never deleted, and that rule is worth more than any
single day's tidiness. What changed is what the read model counts:
`/studios/{sid}/settings/projection.excludedMemberIds`, read by both the live projector and
`pnpm projections:rebuild`. Adding an account to that list and rebuilding is the whole procedure.

## Traps that have already cost something

**OR-14 · Firestore indexes are a production-only trap.** The emulator does NOT enforce them, so a
missing or wrongly-ordered composite index passes every test and fails for every user. It happened
once: an `orderBy(... DESC)` against an `ASCENDING` index took down every member page while the whole
suite was green. After changing any query's ordering, deploy and check the index in production.

**OR-15 · `pnpm check` does not run `next build`.** Some rules — notably "every export of a
`'use server'` file must be an async Server Action" — exist only inside that build. Recorded as
DEBT-031 with the reasoning for not simply adding it to the gate.

**OR-16 · Two copies of the PAYTR callback exist, and PAYTR calls the FUNCTION.** `apps/web`'s copy
is a mirror (DEBT-PAYTR-CALLBACK). A core change reaches App Hosting on push but reaches the callback
only on `firebase deploy --only functions`. This has cost two withheld customer payments; when
touching either copy, check the other.
