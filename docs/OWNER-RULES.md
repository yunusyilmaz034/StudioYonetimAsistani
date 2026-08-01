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

**OR-19 · İptal etmediyse kredi düşer — istisnasız.** (2026-07-30) A reservation holds the credit at
booking and consumes it at resolution, whether or not anyone marked attendance. Marking attendance
CONFIRMS the record; it does not change the credit. The only thing that gives a credit back is a
cancellation inside the window (or the studio cancelling the class, I-27).

Until 2026-07-30 one path disagreed: `noShowConsumesCredit: false` refunded the credit when a trainer
marked a member absent. The same absent member got a different answer depending on whether a human
bothered to mark her — doing nothing was strict, being diligent was generous. It had never fired
(zero no-shows in the studio's history) and is now `true` on all three services. The default for
newly created services was fixed in the same change, so it cannot come back through the front door.

**OR-20 · Çıkışı kimse okutmaz — çıkışı sistem kapatır.** (2026-07-31) There is no turnstile, and
there never will be one in this studio: nobody scans on the way out, and reception has a customer in
front of her. So the exit is the one door event that will never be recorded reliably, and the
occupancy board can only be kept honest by the sweep.

Three things follow, and they are policy, not implementation detail:

1. **A labelled button states a direction; only a QR toggles.** Reception's buttons say "Giriş" and
   "Çıkış". Pressing "Çıkış" twice used to check the member back IN — which is how a member left at
   18:41:27 and was inside again at 18:41:49. A stated direction that contradicts the state is now
   REFUSED. A QR has no label (one code, both ways), so it stays a toggle.
2. **Two crossings inside 45 seconds are one press.** A double-tap or a scanner repeat is not a
   forty-second visit. Refused in the domain, not in the button — the button is not the only caller.
3. **`system` closes a visit after 2.5 hours, hourly.** Long enough for a class, changing and a
   coffee; short enough that the board is right within the hour. It emits `member.auto_checked_out`,
   never `member.checked_out` — a presumption is not an observation (#11).

Owner: *"süpürge çok sık çalışmasın o kadar, sadece bunun için."* Hourly, not every fifteen minutes.

**OR-21 · The dondurma allowance is the studio's standard, and the owner may exceed it — deliberately.**
(2026-08-01) Owner: *"admin yine de istediği kadar dondurabilsin, bazı üyelere inisiyatif
kullanabiliyoruz."* A seven-day package can be frozen for fourteen. This does not soften OR-12; it
adds a named exception on top of it, and the shape of that exception is the rule:

1. **The refusal stays the default.** Reception sees exactly what she saw before — more days than the
   budget is refused, never clamped. The exception is an opt-in flag (`FreezePlan.override`) that a
   caller who does not know about it cannot set by accident.
2. **It belongs to the owner.** `override: true` is authorized against `['owner', 'platform_admin']`
   in the Server Action; reception may spend the terms the studio sells, not exceed them.
3. **It is an act, not a typo.** The screen refuses first and offers the initiative second, behind a
   tick that says what it is about to do. A greyed-out button that will not say why is
   indistinguishable from a broken one — that is how "dondur tuşu çalışmıyor" reached the owner on
   2026-07-31.
4. **What was approved is what is paid back.** The freeze carries `grantedDays`; the unfreeze and the
   nightly sweep both read it, never the budget. Otherwise an approved fortnight would stop her for
   fourteen days and return seven — the studio quietly not doing what it said.
   The owner settled the edge case this creates (2026-08-01): if the sweep fails and a member stays
   frozen SIX days on a THREE-day approval, she is extended by **three**. *"Doğrusu bu — ne söz
   verildiyse o ödenir."* The alternative — paying for the days our own sweep forgot — was
   considered and rejected: the approved duration is the promise, and a bug in our scheduler is not
   a new agreement. It is also the safer failure: a sweep that silently stops running cannot inflate
   memberships behind us.
5. **The exception is countable.** `entitlement.frozen` carries `overageDays`, present only when the
   allowance was exceeded, so *"how often, and for whom, do we go past our own terms?"* has an answer
   that does not depend on anyone remembering. It shows in the activity feed as a warning.

Her allowance afterwards reads **0 gün**, which is exactly true: she has spent fourteen of seven, and
the counter floors at zero rather than going negative. A package with **no** freeze right at all
(Pilates) is untouched by this — there is nothing to exceed, and giving it days is a catalogue
change, made once, for everyone.

**OR-22 · A mobile change that touches a NATIVE surface is run before it is shipped.** (2026-08-01)
WebView, camera, files, notifications, payments — anything where the answer comes from iOS or from a
third party rather than from our own code. 1.2.0 went to both stores with a video player that showed
YouTube's *"Hata 153 · video oynatıcı yapılandırma hatası"* on every exercise. It compiled, it
typechecked, `pnpm check` was green and `next build` was clean; none of those can tell you how a
WebView looks to YouTube. It was found only because the owner asked to see it in a simulator.

So: build it, open it, press the button. Once. The simulator is enough to catch this class of fault —
though **not** to clear video playback, which the simulator's media stack fails at even when the code
is right; that one needs a real device or a real browser.

When a third party refuses, get the fact instead of guessing: a plain HTML page at a real origin
settled in one minute what two rounds of speculation had not. And prefer the honest configuration —
the fix was to stop claiming the page came from `youtube.com` and declare our own domain, which is
what the web player already does.

**OR-23 · A member is Aktif, Duraklatılmış or Pasif — and only one of the three is stored.**
(2026-08-01) The studio had two words doing three jobs: a member whose package simply ran out was
called "pasif", the same word used for a member the studio wants out of the system entirely. One of
those is someone to call this week; the other is someone to delete.

- **Aktif** — she has a live package. A FROZEN package counts: it is paused, not finished, and she
  has already paid. "Donmuş" stays a separate filter, so nothing about her is lost.
- **Duraklatılmış** — her package ended. She is the win-back list, and she stays in "Tümü".
- **Pasif** — the studio wants her out and her data gone. She is hidden from "Tümü" (OR from
  2026-07-31 stands) and one tap away under her own chip.

**Two of these are derived and one is declared, and that is why there is no `state` field on the
member document.** Aktif and duraklatılmış are facts about the credit ledger that change BY
THEMSELVES — a package expires at midnight and nobody presses anything. Storing them would mean every
expiry has to write to the member record: a nightly job that can fail and leave a member reading
"Aktif" with nothing to book. Pasif is the opposite — nothing can compute a human's intention to
remove someone — so it stays where it always was (`Member.status`, written by `member.deactivated`
with a reason). The stored vocabulary is untouched; the three words the studio speaks are derived in
one place (`lib/members/filters.ts`) and read by the list, the member's card, search and the reports.

Two consequences the owner asked for by name:

1. **Selling a package moves her to Aktif instantly.** Nothing runs, nothing syncs — the state is a
   question asked at render time, so the answer is already true the moment the sale lands.
2. **"Aktif üyemiz kaç?" means members who really hold a package.** One number, everywhere — the
   dashboard and the list had been answering it differently. It read 101 and now reads 105 (128
   records: 105 aktif · 21 duraklatılmış · 2 pasif).

   The four are members whose package **starts tomorrow** — three new sales and one renewal bought
   after the old package lapsed. The dashboard's old test asked *"can she book right now?"*; the
   right question for this number is *"is she a customer?"*, and a woman who has paid for a package
   beginning on Sunday is not a win-back target. Frozen members would count too, for the same reason,
   though on the day this shipped there were none.

The state also checks the DATE, not just the stored status, so it never depends on whether the
nightly expiry sweep fired. A frozen package is exempt from that check — freezing stops the clock and
`validUntil` is not extended until it is lifted.

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
