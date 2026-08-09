# Handover — where this project actually is

**Read this first in a new session.** It is the only document that answers "what is live, what is
half-done, and what is somebody waiting on". Everything else in `docs/` explains the system; this
explains the moment.

Keep it current the way the code is kept current: when the state changes, this changes in the same
commit. A handover document that lags is worse than none, because it is believed.

_Last true as of: **2026-08-09**._

Panel live at **`build-2026-08-08-002`** — verified the only way that counts, Cloud Run's traffic
split (100%, created 2026-08-08 15:13 UTC, six minutes after the last commit). Everything through
`d0f9875` is serving. **Cloud Functions were last deployed 2026-08-06** and do not need another: the
core change since then is purely additive (two new turnstile decision functions), so the functions
running older core decide nothing differently.

---

## What this is, in one line

A live, multi-tenant Studio Operating System. One studio uses it for real — **Pilates Fitness by
Işıl**, 120 members — and it is the only system they have: they retired the old one on 2026-07-27.
A day this panel cannot open is a day the business cannot run.

- Panel · `panel.pilatesfitnessbyisil.com` (Firebase App Hosting, `studio-yonetim-prod`, europe-west4)
- Public site · `pilatesfitnessbyisil.com` — static HTML at **`~/pilates-site`** (NOT in this repo, NOT
  under `~/Projects`, and NOT in git — back a file up before editing it). Two pages, `index.html` and
  `uyelik.html`; both read live prices from `/api/public/products`. Deploy: `cd ~/pilates-site &&
  firebase deploy --only hosting` (Hosting site `pilatesfitnessbyisil-web`, same Firebase project).
- Studio id · `retro`. Nothing in the code may assume it is the only one.

---

## Live and working

Reservations, check-in (desk · kiosk · **printed daily QR**), attendance, the credit ledger,
packages incl. hybrids, payments through PAYTR (card, links, wallet), the member portal, the member
mobile app, WhatsApp AI reception, notifications, reports, payroll, and a nightly infrastructure
watchdog (domain expiry, TLS, reachability, renewal dates + a Monday heartbeat).

Members are **Aktif, Duraklatılmış or Pasif** (OR-23) — the first two derived from the ledger, so they
are never stale. Memberships can be frozen, including past the allowance when the owner decides so
(OR-21). The movement guide and an in-app video player are in both the portal and the app.

**Members can buy and renew their own packages** from the app and the portal. A renewal is QUEUED
behind the package it renews so no paid day burns unused; a hybrid queues behind every category it
grants and refuses when they disagree. The studio is notified the moment a self-service sale lands.

## Store state

| | In members' hands | Uploaded, not yet released |
|---|---|---|
| iOS | 1.0.1 (build 4) — live since 2026-07-29 | **1.5.0** (build 11) submitted 2026-08-06; the App Store version must be created by hand |
| Android | **1.3.0** (versionCode 9) — closed test | **1.5.0** submitted 2026-08-06 |

**Ship 1.5.0 and nothing else. 1.1.0, 1.2.0, 1.2.1, 1.3.0 and 1.4.0 are all superseded** — each is
contained in the next, and 1.2.0's video player is broken (OR-22). Several of them were built and
uploaded and never sent for review; let them lapse rather than spend a review turn on any of them.
On iOS pick the **1.5.0** build. 1.5.0 carries the editorial redesign, the late-cancel block (OR-30),
workout tracking (OR-33), the consistency strip, and one price (OR-31).

⚠️ **`apps/mobile/app.json` still says 1.5.0, but the tree is no longer the 1.5.0 that was
submitted.** Two mobile files changed after the 1.5.0 chore commit — `qr.tsx` and `src/lib/api.ts`,
the turnstile's six-digit scanner. A build made today would reach the stores calling itself 1.5.0
while behaving differently from the 1.5.0 under review. **Bump to 1.6.0 before the next build**; the
turnstile cannot reach members until that release ships anyway.

**Android's production clock: 12 testers, 14 days required, and on 2026-07-29 it stood at day 3** —
so it completes around **2026-08-09**, which is now. Check Play Console for the actual state before
assuming either way. If a tester leaves the test the counter RESETS — do not remove testers.
Publishing new builds does NOT reset it, which is why 1.2.0 and 1.2.1 could both go out mid-count
without costing a day.

Submissions are automated: `cd apps/mobile && npx eas-cli submit --platform android --profile
production --latest`. The Play service account key is gitignored at
`apps/mobile/google-play-service-account.json` (`eas-play-submit@studio-yonetim-prod...`); the
`androidpublisher` API is enabled on the project. iOS submits the same way but the App Store version
must still be created and sent for review by hand.

---

## Waiting on the owner

- **iOS 1.5.0 is uploaded; the App Store version has to be created by hand.** App Store Connect →
  + Version → 1.5.0 → fill "What's New" in BOTH Turkish and English (an empty Turkish field greys out
  "Add for Review", which cost a day last week) → pick the **1.5.0** build → submit. Skip every
  earlier version — all of them are contained in it. Test credentials for the reviewer:
  `0500 000 00 01` / `Yu156211` — a member with a live package and a programme, excluded from every
  report.
- **The turnstile's hardware.** The software is live and the device pairing tool exists
  (`pnpm setup:turnstile`), but the Perkotek S150 is not fitted and its firmware is deliberately
  unwritten — writing it blind against hardware nobody has held is how you debug two things at once.
  Nothing runs until the box is on the wall.
- **The Meta invite template `uyelik_daveti_v2`.** Text is drafted and ready to paste into WhatsApp
  Manager (name, category Utility, Turkish, body and the two sample values) — see the section below.
  Once Meta approves it, the code change is ONE line in
  `packages/core/src/modules/notifications/infrastructure/providers.ts`, written out in a comment
  right above the current mapping. Do not switch before approval: an unapproved template name is
  refused at send time and every invitation fails silently.
- **Twenty-one members are DURAKLATILMIŞ** — no live package (2026-08-01, measured). After the fitness
  import that is most likely the genuine number (lapsed, or leads entered as members) rather than
  migration debt. They now have their own filter with a count, which is the list to work through.
- **Sixty-six invitations are still unopened.** The invite screen has the filter and a one-tap
  reminder that mints a fresh link.

## Waiting on us

- **The AI receptionist is healthy; demand is what fell.** (2026-08-05) The owner saw a quiet day and
  asked if something was broken. Nothing is: every incoming WhatsApp message got an AI reply, 100% on
  every day of the week, and the webhook logged zero errors. What dropped is INBOUND — 67 messages on
  1 Aug, 21, 15, then 9 on 4 Aug. That is an advertising/seasonality question (early August empties
  İstanbul), not a software one. Worth checking the ad budget and the number's quality rating in
  WhatsApp Manager before assuming either way.

- **`main` was rewritten once, on 2026-08-03, and the original is kept.** Three unrelated changes went
  out under one commit whose message described only the first of them; the tree was identical but the
  log was misleading, and in this repository the log IS the history. It was re-split into three
  commits (`67054b7` reservations · `fdd9ffb` mobile navigation · `c13cf26` PF-44) and force-pushed
  with `--force-with-lease`. **The pre-split commit is preserved as `backup/pre-split-2026-08-03`,
  both a branch and a tag**, and `git diff` between it and `main` is empty — nothing shipped changed.
  If you pulled between roughly 12:30 and 13:00 that day, reset to `origin/main`.

- **Hybrid purchase, tested live.** One sale must produce N entitlements correctly through the real
  PAYTR path. The rules are written and unit-tested; the path has never run in production.
- **Sanal POS, a real charge.** Also never run for real. Together with the hybrid sale these are the
  two money paths this system has never actually executed — close them before a second studio.
- **The freeze initiative (OR-21) has never been used on a real member.** Watch the first one: the
  membership must extend by the APPROVED days (not the budget), her allowance must then read 0, and
  the nightly sweep must resume her on the approved day. It has no unit tests — the owner's call,
  taken knowingly. If it misbehaves the two places to look are `grantedDays` in `decideFreeze` and
  `budgetEndsOn` in the sweep.
- **Twenty-one duraklatılmış members are a work list nobody has worked.** They now have a filter with
  a count; that is the win-back call list.
- **The turnstile's device firmware.** Deliberately unwritten until the S150 is in hand — writing it
  blind means debugging the firmware and the protocol at the same time, against hardware nobody has
  held. Everything on our side is built, tested and live; `pnpm setup:turnstile` mints the pairing.
- **`apps/mobile` still calls itself 1.5.0 while carrying the turnstile scanner.** Bump to 1.6.0
  before the next build, or the stores get a second, different 1.5.0.
- **External uptime monitoring.** The watchdog cannot report its own suspension — if the project is
  suspended over an unpaid bill, every alarm goes quiet, which looks exactly like all-clear. The
  Monday heartbeat covers this partially by making silence the signal.
- **Product roadmap Faz A** (`docs/PRODUCT-ROADMAP.md`) — per-studio WhatsApp number, per-studio
  e-mail sender, one-command studio provisioning. Nothing blocks a second studio until these exist.
  No urgency; a second studio (Novozen) has asked but nothing is agreed.

---

## What shipped on 2026-08-01 — a long day, four pieces

Panel live at **`build-2026-08-01-008`**. Mobile **1.2.1** uploaded to both stores. All of it is
deployed; none of it needs another push. Read this before assuming something is half-done.

**1 · The freeze initiative (OR-21).** The owner may now freeze a member PAST her allowance — fourteen
days on a seven-day package — deliberately, behind a tick that says what it is about to do. Reception
still sees the plain refusal; only owner/platform_admin may exceed. The freeze records `grantedDays`
(what was approved) and the event carries `overageDays`, present only when the terms were exceeded, so
*"how often, and for whom, do we go past our own terms?"* has an answer. The unfreeze and the nightly
sweep both read the approval, never the budget. Shipped App Hosting + **functions** (the sweep lives
in a function). `098c5f8`.

**2 · The movement guide reached the app, and video plays in place.** Tapping an exercise in the
mobile app opens the panel's guide — target-muscle body diagram, movement summary, correct movement
with photos and cues, common mistakes. Everything it renders was already in the training payload; the
app simply was not showing it. Which muscles to paint is now resolved SERVER-side into
`ExerciseGuide.primaryMuscles/secondaryMuscles`, so a new exercise lights up in both clients with no
app release. Form videos no longer throw her out to YouTube: they play in a popup (iframe on web,
WebView in the app), both built from one shared `youtubeEmbedUrl`. `9a39ecc`.

**3 · Three member states (OR-23).** Aktif · Duraklatılmış · Pasif, all three filters on the members
page with counts. Only *pasif* is stored (it is a decision); the other two are derived from the ledger
at render time, so selling a package moves her to Aktif with nothing to run. The derivation also
checks the DATE, so it never depends on whether the nightly expiry sweep fired. `5b0b5a0`.

**4 · The corrections, which matter more than the features.** Two things were said wrongly and then
fixed — both are written down because a handover that explains a number wrongly is worse than one
that does not explain it:

- 1.2.0 went to both stores with a video player that failed on EVERY exercise. It compiled,
  typechecked, `pnpm check` was green and `next build` was clean. It was found only because the owner
  asked to see it in a simulator. → **OR-22**, and 1.2.1.
- The dashboard's "aktif üye" moving 101 → 105 was attributed to frozen members. There are none. The
  four are members whose package started the NEXT day (three new sales, one renewal bought after the
  old one lapsed). The rule stands; the reason was wrong.

Today's shape: **128 records — 105 aktif · 21 duraklatılmış · 2 pasif.**

### Shipped since, in 1.3.0 (2026-08-03)

Three navigation faults and PF-44. Cüzdanım had no stack entry, so it had no header, no back button
and no tab bar — the member opened her wallet and the app stopped. Üyeliğim was the mirror of it,
passing `header` on a TAB and running under the notch. The training tab derived its own label from
her subscriptions while the screen used the server's answer, so the two could disagree; both read the
server now and it reads "Ölçümlerim". PF-44 put a show-password eye in all six password fields, one
component per platform. **Both navigation fixes were seen in a simulator before upload** (OR-22);
the "Ölçümlerim" label was not — it needs a pilates-only member, so check it on a real account.

Also that day: **recording a class that already happened** (OR-24) — reception adds a walk-in to a
finished class from the attendance panel and the credit is consumed. Web-only; no app change.

### Shipped 2026-08-05 — the desk's day, and measurements that read themselves

Three pieces, in the order they were asked for.

**The dashboard checklist is a to-do list again.** A ticked item used to vanish, so at six o'clock
reception had no idea what she had closed. Done items now stay on the list, struck through, and each
one records **who** closed it (`studios/{sid}/checklistDone/{dayKey}`, `items.{id} = {byName, at}` —
server-only in the rules). Işıl ticking something no longer makes it disappear for whoever opens the
panel next.

**The measurement form asks for what the scale prints.** Kilo · İdeal kilo · Yağsız kütle · Kas ·
Sıvı · Yağ, each in kg AND %, laid out as the printout lays them out. BMI, BMR and visceral left the
FORM but not the RECORD — 56 of the 57 readings taken so far carry them, and a correction still
preserves them.

**And now the form fills itself from the scale's PDF** (OR-27). Reception uploads the Tanita printout,
the model reads the numbers off it, the fields are pre-filled, and **a human still presses Kaydet**.
Unreadable, or not a scale printout at all → "PDF okunamadı", manual fields underneath, nothing saved.
Verified against the live API before shipping (OR-22): a synthetic RD-545 sheet returned all thirteen
fields correctly, ignoring the parenthesised normal ranges — the trap that would otherwise record
`53.09` as an ideal weight of `59.41` — and an invoice PDF was refused rather than mined for numbers.
Round trip ≈ 9 s, so the button says "Okunuyor…" and gives up at 45.

Two things to know about it. **The PDF is never stored** — read once, discarded; it is a data source,
not an attachment. And this is the **only** AI call in the product that carries a member's name: a
printout cannot be tokenised before it is read. OR-27 states the trade and what to do if it stops
being acceptable.

The member sees a **"Son iki ölçüm arası"** summary — in the app and in the portal, from one shared
function (`compareMeasurements` in `@studio/core/client`), computed from the stored readings rather
than the PDF, so it works for every reading taken before PDFs existed. It carries **no verdict**, on
purpose: see OR-27.

Model note: this call uses `claude-opus-5`, not the Haiku the daily briefing uses. A misread digit
lands in a member's record, and the volume is a handful of readings a week.

**Verified against a real RD-545 printout the same evening.** Three findings worth keeping:

- **The sheet has no usable text layer.** Three pages, 146 embedded images, subset fonts — plain text
  extraction returns nothing readable. A regex parser would have scored zero on this file; the model
  reads it visually. That is the reason there is no PDF library in `apps/web`, and the reason to be
  sceptical of any future "just parse the text" simplification.
- **The multi-row trap is real and it is handled.** Page 3 is a full history table (three dated
  readings) and page 2 prints score pairs as `E | S`. The parser took the newest row and the `S` side
  every time. Both rules are now written into the prompt explicitly rather than being got right by
  luck.
- **`Bel (cm)` was on the sheet while Çevre ölçüleri sat empty**, so the waist is now filled in too —
  an existing `Bel` row is updated, never duplicated, and the ratios beside it (`Bel/Kalça 0.78`,
  `Bel/Boy 0.45`) are refused by a 30–250 cm band so `Bel 0.78 cm` can never reach a record.

Three consecutive runs over the same file returned byte-identical output.

**The sheet also carries the member's PREVIOUS readings** (`Fark Analizi`, dated rows). Backfilling
history from them is possible and was deliberately NOT built — nobody asked, the rows carry only four
of the fields, and inventing dated measurements nobody entered is the sort of thing that is hard to
unpick later. It is an option, not a plan.

### Shipped late on 2026-08-05 — Sanal POS, and online sales get a human step

**Sanal POS was broken for every member without an e-mail address, and had been.** The PAYTR token is
an HMAC over fields we also post; the hash signed `''` while the body carried a placeholder, so PAYTR
could not verify it. Confirmed against the live endpoint, fixed, and covered by a test that recomputes
PAYTR's hash from the body actually posted — so a mismatch in *any* field fails, not just this one.
`debug_on` is now always on: with it off, a rejected token comes back as a **zero-byte body**, which is
why the error read `paytr_token_failed` and told nobody anything. See OR-28.

**Online membership sales already existed** — `/uyelik?s=retro`, a public page with the price list, a
KVKK-consented buyer form, rate limiting and PAYTR. What changed is the ending. The callback used to
find-or-create the buyer and grant the package unattended; now it stops at paid and **reception creates
the membership** from a card on the dashboard (OR-29). One press attaches the money, grants the package
and sends the invite. A phone already on the books is shown as a named suggestion, never merged.

The marketing site is done too, and it was never out of reach — it lives at `~/pilates-site` (see the
address list at the top). `uyelik.html` already listed every online package with a Satın Al button;
what was missing was the homepage, where the four package cards offered only "Bilgi al" on WhatsApp.
Each card now offers both, and the buy button carries the **card-inclusive** total read live from
`/api/public/products` — the price printed on the card is the studio's CASH list and is deliberately
lower, so sending someone from a ₺8.000 card to a ₺9.000 checkout would have been a nasty little
surprise. A package that stops being sold online loses its button by itself, with nothing to deploy.

**The site also had to stop promising "üyeliğin anında aktif".** It is not, any more — reception
creates it (OR-29). Every instance on both pages now says the payment is taken and reception creates
the membership. If that human step is ever removed, these lines have to move back with it.

⚠️ **This one needs BOTH deploys.** PAYTR calls the Cloud Function (OR-16), so `firebase deploy --only
functions` is what actually changes what happens after a payment; App Hosting alone only changes the
panel.

### 2026-08-06 — the late-cancel incident

A member late-cancelled the same class twice in fifty-one seconds from her phone and lost two credits.
She rang the studio. **The audit is closed and it is small: those two are the ONLY late cancellations
in the system's entire history**, both hers, both today, both self-service — no other member has ever
been charged this way. Her two credits were restored through the panel's own adjustment path
(`reason: correction`, note recorded, landing in `restored`, never `granted`); her ledger now reads
8 granted − 1 attended − 1 held for her 7 Aug booking = **6 available**, which is correct.

The rule changed with it — see OR-30. A member can no longer cancel inside the window at all, the
refusal lives in the domain rather than in a hidden button, and no member surface says "geç iptal"
any more.

### 2026-08-06 — the member app's new design language, and one price

**Mobile.** The app moved to "Stüdyo Editoryal" — the marketing site's own bone paper, mahogany ink
and Georgia, so the app and the website stop looking like two businesses. Screens kept their layouts
(OR-6's discipline applied to mobile); what changed is material. Four tabs: **Bugün · Ajanda ·
Antrenman|Ölçümlerim · Ben**. The third tab's NAME comes from the server (`TrainingBundle.
showPrograms`) — a pilates-only member never meets the word "Antrenman", not as a label and not as an
empty state. Üyeliğim, Cüzdan, Mesajlar and Profil merged into **Ben**; QR moved to each screen's
top-right.

Two things learned the hard way and worth not repeating: a word-only tab bar (no icons) reads as a
caption strip and was rejected twice; and a fixed `height` on `tabBarStyle` overrides the safe-area
inset, which pushes labels onto the home indicator. Bugün now drops any module with nothing to report
— the empty attendance card and the "∞ kalan hakkın" figure are gone — and shows the studio's next
open day as four lines of timetable instead.

**These mobile changes are NOT in members' hands.** They need a store release (1.4.0), which also
carries OR-30's cancel block.

**One price (OR-31).** The cash/card split is over: every package is one number in cash, by transfer
and on the card, and PAYTR is sent that number. The KK/havale farkı mechanism stays, zeroed to `0` in
every category — visible in Ayarlar › Ödeme and one number away from returning. Written to production
by `pnpm setup:single-price` (each change a `product.updated` event): Pilates 8 Ders ₺5.000 · Fitness
3/6/12 Aylık ₺9.000/₺14.000/₺22.000, with 12 Aylık newly created; **Pilates 16 and 24 Ders are
deactivated** — not sold, no price shown. The four hybrid bundles were re-derived from the same two
anchors (a pilates lesson ₺625, a fitness entry ₺400) rather than simply raised: ₺4.500 · ₺5.500 ·
₺6.500 · ₺18.000. Untouched, and therefore still on the OLD arithmetic: Fitness 1/2 Aylık, Reformer
4 Ders, PT 8 Ders.

**Nothing reached an existing member.** An entitlement freezes its `productSnapshot` at purchase, so
repricing the catalogue cannot rewrite a right already sold — no migration, no reconciliation, and
nothing to tell members about their current packages.

Live already: prices (data, so every surface that reads the catalogue is correct now), the marketing
site, and the WhatsApp AI (functions deployed — it now prints one figure and refuses to invent an
instalment rate). **Waiting on the night deploy: the panel/portal copy** (App Hosting). The mobile
buy screen's new footnote rides with 1.4.0.

### 2026-08-06 (evening) — one price, discounts, and the workout log

**Tek fiyat (OR-31) shipped in full.** Catalogue, marketing site, panel/portal copy and the WhatsApp
AI are all live. The AI's `policies` field had been TEACHING the old model in prose ("nakit fiyata
1.000 TL eklenir", "3 taksitte banka %10 alır") — a correct live price plus an instruction to add a
surcharge to it. Rewritten. The four hybrid bundles were re-derived from two anchors rather than
raised: a pilates lesson ₺625, a fitness entry ₺400 (so ten entries = one unlimited month, which
makes the boundary explain itself).

**İndirim (OR-32).** A price the studio comes down to is now a discount, not a debt. Owner-only,
enforced in the Server Action; reason optional (`manual` still needs a note — I-36); the line keeps
the LIST price so "we came down" never collapses into "we sold something cheaper". History was
audited first: five open balances, none a disguised discount, zero discounts in the system ever.

**Antrenman takibi (OR-33).** The member ticks each exercise, records sets/reps/weight and a note,
and finishes the day; the cycle is walked in order with the refusal in the DOMAIN. Her declaration
is never added to the door's observation — they meet only on the staff adherence view, where the GAP
is the signal.

**Two bugs found by fixing a type.** `/fitness` had been typed as core's `MemberFitness` while the
endpoint returns `{ stats, recent }`: every read was `undefined`, so "Son 30 gün" on Bugün and the
streak line on Ben had never rendered and nothing said so. And the home progress line picked "the
first active programme" when a member can hold several — it now follows the one she trained most
recently. **When a member-facing number never appears, suspect the type before the data.**

**Data corrected in production:** Program B's template had day names that disagreed with their order
(`order:1` was called "2. Gün"), which made a correct cycle look broken. 149 programmes audited, 1
affected, fixed at the template and the programme. Names were moved onto their order, never the
reverse — renumbering would have re-labelled work already done.

### Shipped 2026-08-07 — the discount reaches the desk's real case, and a door gets built

**İndirim after the sale, not only during it (OR-32 extended).** Yesterday's discount lived at the
point of sale, and within a day the desk hit the case it could not reach: reception sells at list,
takes what the member brought, and the rest is agreed away afterwards. A ₺5.000 package with ₺4.200
collected sat at ₺800 *debt* — money the member does not owe, on the owner's collection list. Üye ›
Paket › Düzenle now offers **İndirim Uygula** beside Tahsilat Al: the sale keeps its gross, gains a
discount, and settles. Editing the agreed price down would close the balance too, but it destroys
what the package costs and the fact that anything was given away — **a studio that cannot count what
it discounted cannot decide whether to keep doing it.** A discount larger than what is still OWED is
refused, never clamped: forgiving money already in the till is a *refund*, a different act with cash
going back. Owner-only; `manual` still needs a note (I-36); the event carries `totalBefore`/
`totalAfter` so revenue can be corrected from the log alone.

**The turnstile (OR-34).** A Perkotek S150 — dry contact, no reader, no network, no opinion. A screen
beside the arm shows a six-digit code; the member scans it with her phone; we answer from her
packages, her freeze and her balance. The code lives 45 seconds, is bound to its device, and is
single-use **spent in a transaction** — single use IS the race, and read-then-write would let two
phones pointed at the same screen both in. The code is spent BEFORE the check-in is recorded, so a
race fails as "the door did not open" rather than "two people crossed on one code".

It emits `member.checked_in` with `method: 'device'` — the field has sat unused since the first
commit waiting for exactly this (AD-18), so occupancy keeps one arithmetic and one debounce. The
device is a principal with its own id and secret; only the secret's SHA-256 is stored. The full rule
is OR-34. **`pnpm setup:turnstile` pairs a device and prints the secret ONCE** — there is
deliberately no way to read it back; lose it and you mint a new one and deactivate the old device.

One fault, caught by probing the live endpoint after deploying: `POST /api/turnstile` answered **307,
not 401**. The coarse cookie gate treated it as a panel page and bounced it to `/login`. A box bolted
to a wall has no `__session` cookie, cannot follow a redirect, and would never report one — so the
arm would have stopped opening with nothing anywhere saying why. The exemption went in **as a test**,
not as a line someone can quietly delete. *This is what "probe the live endpoint after deploying"
buys, and it is the second time it has paid (OR-22).*

### Shipped 2026-08-08 — a rule enforced on the way in, and a panel that can be photographed

**A pilates-only member cannot be given a workout programme (OR-35).** The rule was settled on
2026-08-06 and it shaped the member app — but it was only ever enforced where the data is
**displayed**. The app hid the tab while the panel happily assigned a programme anyway, and one was,
to a member holding a single Reformer package. **A rule that lives only on the read side is not a
rule; it is a preference the next screen ignores.** One function (`mayHaveProgram`) now answers it
and both sides call it; the two doors that create a programme refuse, and the panel hides the buttons
*and says why* — a button that is merely absent is a button a second screen still presses. A member
who already HAS a programme keeps it: nothing granted is taken away by a rule written afterwards.

The audit matters more than the fix. Six programmes had no fitness/PT package behind them and only
**two** were this bug — four belonged to fitness members whose package had EXPIRED, and their
programme must be waiting for them when they renew. Archiving those would have looked like tidying
and been a small act of vandalism. The two real ones were **archived, never deleted**: deleting
erases the evidence of the bug being fixed.

**Demo mode.** The platform's marketing screenshots and a second studio's live demo both need the
panel open — with forty women's names, phone numbers and gym times on screen. Names become "Ayşe K.",
phones `+90 5•• ••• •• 47`, and **every number, date, occupancy and amount stays real**: a demo
convinces because it moves like a real business, not because the figures were invented.

Three properties, each deliberate. It **writes nothing** — not to Firestore, not to the event log,
not to studio settings, so turning it off is easier than turning it on. It lives in a **cookie, not
settings**, so the owner enabling it does not mask reception's screen — how the panel looks belongs
to a person, not a studio. And the masking happens on the **server**: sending the real name and
blurring it in CSS is not masking, it is a screenshot that still carries every name in the page
source. Pseudonyms are deterministic, so one member is the same "Ayşe K." on the calendar and in the
member list; the surname is dropped rather than kept as an initial, because in a studio this size
"S. G." is a short list.

It missed one screen, caught in a screenshot the owner had already taken: the **Stüdyodan öneriler**
list still carried real names, and beside each one "23 gündür gelmiyor" — that screen alone would
have published both who the members are and which of them are drifting away. Fixed the same evening.
**A demo mode that works on most screens is not a demo mode, and the screen it misses is the one that
ends up in a screenshot, because nobody re-checks a feature they have already seen working.**

**Demo mode is finished — nothing is outstanding on it.**

---

## Things that will bite you

Read `docs/OWNER-RULES.md` §"Traps" before touching the areas it names. In short:

- **Every deploy breaks whatever tab is already open.** Next.js gives each Server Action a
  content-hashed id baked into the page; a new build changes the ids, and a page loaded before it
  gets `Failed to find Server Action … from an older or newer deployment` on the next save. It looks
  like the feature is broken. It is not — that copy of the panel is stale.
  **So: batch fixes into one push while the studio is open, and tell reception to reload once after.**
  Three pushes in ninety minutes on 2026-07-29 cost reception a member registration she could not
  save and a member an invite she could not activate; both were healthy, both tabs were not.
  Staff forms now name the cause and offer a reload button; the invite page reloads itself
  (`apps/web/src/lib/stale-deployment.ts`). Neither helps a page that was already open — only the
  reload does.
- **"Deploy oldu mu?" sorusunun tek doğru cevabı Cloud Run'ın trafik dağılımıdır.** App Hosting'in
  `builds`/`rollouts` listeleme uçları sıralamasız çağrıldığında eski bir sayfa döndürüyor ve
  2026-07-30'da iki kez "deploy tetiklenmedi" diye yanlış teşhise yol açtı — dağıtım çalışıyordu.
  Komut `docs/RUNBOOK.md`'de. Yanlış bir yeşil, kırmızıdan kötüdür: o gün stüdyo açıkken deploy
  edilmediği sanıldığı için resepsiyona haber verilmedi (OR-17).
- **Never hand-write a production document. Go through the use-case.** On 2026-07-31 five documents
  were written directly, each missing or mistyping a field its type declares, and each broke
  something: an `archivedAt` froze the member workspace; an entitlement with numeric dates where
  Timestamps were expected TOOK THE WHOLE PANEL DOWN; a `createdAt` on five exercises broke the
  training panel again; `photoUrl: ''` (the type says `string | null`) crashed the exercise detail;
  and two programme templates written with four of their nine fields showed as passive and
  unlabelled. The type is the contract — the screen you happen to be looking at is one reader of it.
  If no use-case exists for what you need, write one.
- **Core changes need TWO deploys.** Push updates App Hosting; the Cloud Functions need
  `firebase deploy --only functions`. The PAYTR callback that actually runs is the FUNCTION.
- **The emulator does not enforce Firestore indexes.** Ordering changes must be verified in prod.
- **`pnpm check` does not run `next build`.** Some rules only exist there (DEBT-031).
- **Production data is never edited by hand.** A paid-but-not-granted payment is settled through the
  break-glass endpoint on the callback function (`?admin=settle`, token = `WHATSAPP_VERIFY_TOKEN`),
  which runs the same domain path and writes the same events, with the actor recorded as
  `platform_admin/break_glass`.

## The invite template waiting for Meta approval

Paste into WhatsApp Manager → Message Templates → Create.

- **Name** `uyelik_daveti_v2` · **Category** Utility / "Bilgilendirme" · **Language** Turkish (tr)
- No header, no footer, no buttons.
- **Body:**

```
Merhaba {{1}} 🌸 Pilates Fitness by Işıl'da üyeliğin artık dijital. Derslerini kendin ayırtabilir, kalan ders hakkını ve antrenman programını görebilirsin.

Üyelik sayfan hazır, buradan açabilirsin:
{{2}}

Daha sonra dilediğin zaman şu adresten ulaşırsın:
https://panel.pilatesfitnessbyisil.com/portal/login?s=retro

Bir sorun olursa bize yazman yeterli, yardımcı olalım 💛
```

- **Samples** (Meta refuses to review without them): `{{1}}` = `Ayşe`,
  `{{2}}` = `https://panel.pilatesfitnessbyisil.com/invite/retro/ORNEK-BAGLANTI`

### Do NOT accept the "Kimlik Doğrulama" category Meta suggests

Meta's classifier reads "şifreni oluştur" and "giriş yaparsın" as authentication and offers that
category as *Recommended*. It is a trap. Authentication templates are locked to a one-time-passcode
shape — fixed body, copy-code button, no arbitrary links — so ours cannot exist there at all, and
accepting it would break invitations entirely.

The category is genuinely Utility: this is a message about an account the member already has. The
wording above therefore says nothing about passwords or logging in; the invite page explains that
step when she arrives, which is where the explanation belongs anyway.

### If it is still rejected

Replace the second URL with a button: name `Giriş sayfası`, static URL
`https://panel.pilatesfitnessbyisil.com/portal/login?s=retro`. Meta prefers URLs in buttons, and a
body with only one link classifies more cleanly.

## Where the rest lives

| | |
|---|---|
| Why the system is shaped this way | `docs/architecture/` (`AD-nn`, 21 invariants) |
| How we work, milestone policy | `docs/architecture/10-development-workflow.md` |
| Standing owner decisions | `docs/OWNER-RULES.md` |
| Deliberate debt + repayment triggers | `docs/DEBT.md` |
| Ideas raised, not yet built | `docs/PRODUCT-FEEDBACK.md` (`PF-nn`) |
| Selling this to a second studio | `docs/PRODUCT-ROADMAP.md` |
| Operational procedures, backups | `docs/RUNBOOK.md` |
| What changed, milestone by milestone | `CHANGELOG.md` |

**And the git log.** Commit messages in this repository are written to explain *why*, not what —
`git log --oneline` is the honest history of every decision, including the ones that turned out
wrong and were reversed.
