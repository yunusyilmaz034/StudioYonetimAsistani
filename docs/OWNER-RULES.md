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

**OR-24 · A class that already happened can be recorded, for thirty days, and it takes the credit.**
(2026-08-02) Owner: *"Üye bugün kimseye sormadan çıkmış gelmiş, biz derste yer vardı aldık ama
sistemin bundan haberi yok, dolayısıyla kadının kredisi düşmedi."* The studio gave away a class it
was owed, and nothing in the system could put that right.

Reception adds her from the session's attendance panel. One transaction writes what happened, in the
order it happened: `reservation.booked` → credit **held** → `reservation.attended` → credit
**consumed**. Both halves or neither — a booking without its attendance would leave a credit held
against a class that is over and can never resolve.

The attendance is an **observation** (#11): a human is stating she was in the room, so it is
`reservation.attended` with a human source, never the `system` actor and never `auto_resolved`. Its
`minutesAfterStart` therefore reads in days, which is the truth about when it was recorded.

The owner's three decisions, and each is a refusal the code makes:

1. **Full class → refused.** If the room really held one more, raise the class's capacity first.
   Overfilling silently would make the occupancy report stop meaning anything.
2. **Thirty days.** Beyond that the instrument is a credit adjustment with a reason, not a rewritten
   past: a month that has been reported on should stay reported on.
3. **Reception + owner.** It happens at the desk and reception is who must fix it; every write
   records who did it.

Everything else is decided by the SAME functions the live path uses, so capacity, the category wall,
the service wall, credit availability and double-booking refuse exactly as they always do — a
parallel "past booking" decision function would be a second place for the invariants to be got wrong.
Backdating changes only what it must: the past opens (opt-in, so no caller reaches it by accident),
the studio's opening hours are not re-litigated (the class is its own evidence the studio was open),
and one NEW check appears because only backdating can trip it — **a package that started after the
class cannot pay for it.** The per-member reservation limits are deliberately skipped: they ration
what she may still book, and a class she has already attended cannot be rationed.

**OR-25 · Every pushed screen needs a way back.** (2026-08-02) Cüzdanım had no entry in the mobile
stack, so it fell through to `headerShown: false` — no header, no back button, and no tab bar
underneath it. The member opened her wallet and the app stopped. The mirror of it on the same day:
the Üyeliğim TAB passed `header`, which tells a screen a stack header is already above it, so it
skipped the top inset and ran up under the notch. **A screen either has a header above it or draws
its own; `Screen header` is a statement about what is above, not a style.**

**OR-26 · The trainer keeps her own row, and it now holds two of reception's screens.** (2026-08-03)
Owner: *"Bizim hocalar biraz da resepsiyona bakıyor, o yüzden tam resepsiyon olmasa da rezervasyon
ajandasını falan görsün."* Buse and Reyhan cover the desk in practice, so **Rezervasyon Ajandası and
Check-in** are theirs — with real rights, not a read-only view: they book, cancel, hold seats and take
entries. A screen whose buttons are all refused is worse than no screen, and that is a fault this
studio has already paid for twice.

What did NOT move, and why the trainer still has her own row rather than "reception minus a few
things": the members list (the studio's PII at large — she sees the names in HER classes, which is
what her craft needs), the till, the sales funnel, the reports, the analytics, the studio-wide
payroll, and the AI advisor. Each of those either reveals the business or hands her data she has no
work to do with.

One act inside a screen she now holds stays at the desk: **recording a class that already happened**
(OR-24). It consumes a credit and rewrites a day that has been reported on, and OR-24 named who may
do it. Widening the agenda is not a reason to widen that too — so it is not merely refused for a
trainer, it is not drawn for her.

**OR-27 · The scale's printout is a data source, and reading it is the one AI call that carries a
name.** (2026-08-05) Owner: *"pdf den alanları okuyalım, ölçümdeki o alanları biz otomatik dolduralım
ve isterse admin veya resepsiyonist kaydetsin, böylece data girişi pdf üzerinden olur daha güvenilir;
okunamazsa okunmadı deriz."* So: reception uploads the Tanita PDF, the model reads the numbers, **the
form is filled in and a human still presses Kaydet.** The model never writes a measurement — a misread
digit is caught by the person holding the paper, because what she is looking at is what is on her
screen. Manual entry stays, unchanged, for the day the printer has no paper.

Two consequences worth writing down:

- **The PDF is never stored.** It is read once and discarded. No bucket, no retention window, nothing
  to erase when a member asks to be forgotten. It is a data source, not an attachment — which is what
  the owner asked for after first considering an attachment field.
- **This is the exception to "PII never leaves for the model".** Every other AI call in this product
  tokenises the member's name before it goes out (⟦m1⟧). A printout cannot be tokenised before it is
  read: her name is on the sheet and the sheet is what we send. The prompt forbids returning it and
  nothing but numbers is ever kept, but the document itself does leave. The alternative is typing
  every reading by hand. **If that trade stops being acceptable, the feature comes out — the manual
  fields underneath it are the whole fallback.**

The comparison a member sees between her last two readings is computed from the STORED readings, not
from the PDF, and carries **no verdict** — owner: *"yorumlayacağımız bir şey yok aslında."* A member
who traded two kilos of fat for one of muscle must not be told she gained weight and therefore did
worse. Numbers and a direction; the trainer interprets, in person.

**OR-29 · Online satış: para gelir, üyeliği bir insan kurar.** (2026-08-05) The public sales page
(`/uyelik?s=<studio>`) already took card payments and granted the package unattended. It no longer
does. Owner: *"panelde admine dashboarda düşsün, buradan üyelik oluşturma ve paket ataması yapılır ve
üye ile ödeme eşleştirilir."*

So the PAYTR callback now stops at **paid**: the money is recorded, the membership is not. Reception
sees the purchase on the dashboard, says who the buyer is, and one press grants the package, attaches
the payment and sends the invite. What was given up is speed — the buyer used to have her package
seconds after paying. What was bought is that the studio meets a new member by name, and that a phone
already on the books is looked at by a person instead of matched by a machine (AD-40).

Three things that follow, and must survive any later change:

- **The pending list is meant to be EMPTY.** Every row is someone who has paid and has nothing. It
  sits above the day's checklist, turns amber after three hours, and vanishes when there is nothing
  waiting. If it is ever quietly hidden, the failure mode this whole design introduced goes unwatched.
- **One grant, two triggers.** A staff sale is granted by the callback, an online sale by reception,
  through the SAME function — so the two can never drift into granting different things.
- **The grant happens BEFORE the purchase is marked fulfilled.** A crash in between leaves the row on
  the list: visible and repeatable. The other order would hide a purchase that never got a package.

**The buyer is told what actually happens**, not "üyeliğin hazır": payment received, reception will
create the membership and send the invite, and the studio's own number to call — read from settings,
never typed into the code, because this page belongs to the product and not to one studio.

**Not built, on purpose: a basket.** A studio sells one package at a time; a cart means lines,
quantities and a second model of everything for a case nobody has had. Adding it later is easy.

**OR-30 · A member cannot cancel late, and never meets the words "geç iptal".** (2026-08-06) A member
cancelled the same 12:00 class twice within fifty-one seconds from her own phone, lost two credits,
then rang the studio to ask why. The system had applied the policy exactly as written. The policy was
the problem: her screen offered an "İptal" button with a warning underneath, and she read it as an
ordinary cancellation — which, from where she stands, is what it was.

Owner: *"bizde geç iptal falan diye bişey olmasın… üyeler bunu normal kredi iptali olarak görüyor
sonra kredim niye eksildi derler."* So the rule has two halves, and both are enforced, not hoped for:

- **Inside the cancellation window a member's own cancellation is REFUSED** — in the DOMAIN
  (`decideCancellation`, `selfService`), not by hiding a button. The reservation stays, no credit
  moves, and the app tells her to call the studio. It costs her nothing she had: if she does not
  come, the class resolves under the attendance default and takes the same single credit — but under
  an honest name, and after a phone call in which somebody could have offered her the seat back.
- **RECEPTION can still late-cancel.** A person at the desk can see the case in front of her and
  explain it; a member alone with a phone cannot. That asymmetry is the whole point.

**"Geç iptal" is the studio's accounting word.** On any member surface the label is "İptal edildi".
Asserted structurally in `apps/web/src/app/member-vocabulary.test.ts`, which also checks the desk
still has the distinction — so nobody can satisfy the test by deleting the concept.

The same incident exposed a second confusion, fixed with it: the reservation roster listed
`late_cancelled` members as participants while the session counter did not count them, so a panel
showed five names above a "5/8" that meant three bookings plus two seats held for guests. The roster
now lists `booked` / `attended` / `no_show` only — someone who cancelled is not on the class — and
the counter says its own split out loud when seats are held.

**OR-31 · One price. Cash, transfer and card are the same number.** (2026-08-06) The studio used to
quote a cash list and add a KK/havale farkı on top — 10% on pilates and PT, a flat ₺1.000 on fitness.
Every surface then had to explain which number it was showing, and the member met whichever one she
happened to land on: the website printed the cash price, the checkout charged the card price, and the
gap between them was discovered at the payment step.

From today there is one number per package and it is the same in cash, by bank transfer, and on the
card. PAYTR is sent exactly that number.

**The surcharge MECHANISM stays and is zeroed as DATA, not deleted as code** (owner: *"kk farkı
sistemi kalsın ama hepsi şuanda 0 olacak"*). Every category carries an explicit `0` in Ayarlar ›
Ödeme, so the rule is visible and one number away from coming back — no deploy, no migration. Ripping
it out would be a one-way door for a pricing decision that may not be permanent. Everywhere that
compares the two prices already guards on `total !== cash`, so at zero the second number simply stops
being rendered.

**Instalments are the bank's business, and we say so.** The card offers a plan, PAYTR applies the
bank's vade farkı, and the studio quotes no rate because it sets none. Every buying surface carries
the same sentence, and the AI receptionist is told in the same breath never to invent an instalment
figure: *"taksit seçeneklerine göre vade farkı oluşuyor, ödeme ekranında net tutarı görebilirsiniz."*

The opening list (prices are DATA — this is the record of the decision, not the source of the
numbers): Pilates 8 Ders ₺5.000 · Fitness 3 Aylık ₺9.000 · 6 Aylık ₺14.000 · 12 Aylık ₺22.000 (new).
**Pilates 16 and 24 Ders are no longer sold and carry no price** — deactivated rather than left on a
shelf at a number nobody honours. Written by `pnpm setup:single-price`, through the product's own
domain path, so each change is a `product.updated` event.

**The hybrids were re-derived rather than raised.** (approved 2026-08-06) Their old prices had no
formula in them: pilates was always charged at list, but a fitness entry cost between ₺325 and ₺525
depending on which bundle it sat in — four bundles, four arithmetics. Raising them would have raised
the inconsistency too. Two anchors now, both read off the single-price list: **a pilates lesson =
₺625** (5.000 ÷ 8, and the 4-Ders package independently agrees) and **a fitness entry = ₺400**, chosen
so ten entries equal one unlimited month — which makes the boundary explain itself and stops the two
products competing. The three-month bundle takes a further −10% for the commitment. Result: ₺4.500 ·
₺5.500 · ₺6.500 · ₺18.000. The first is the owner's own number, not the formula's (₺4.100 would have
been a price CUT inside a general increase) and is marked as such in the script.

**A price change never reaches a sale already made.** An entitlement carries its own
`productSnapshot` — name, category, grant, listPrice, serviceIds, package rules — frozen at purchase,
and a payment records what was actually agreed. Editing the catalogue tomorrow cannot rewrite a right
someone already paid for, which is why repricing needs no migration and no member communication about
the past (owner: *"geçmişte bu paketleri alanları dokunma"*).

**OR-32 · A price we came down on is a DISCOUNT, never a debt.** (2026-08-06) The single-price move
(OR-31) raised every package, and the studio still comes down for individual members — a ₺5.000
pilates package sold to a regular for ₺4.200. Recording that as ₺4.200 collected against a ₺5.000
sale left ₺800 open: a balance the member does not owe, sitting in her cari hesap and on the owner's
"to collect" list forever. Owner: *"800 tl borç yazamamalı, 800 tl indirim yapıldı borçsuz tahsilat
yapılacak."*

The ledger was already built for this and nothing had ever used it: `Sale.discounts`, with
`total = gross − Σ discounts`. What was missing was a field at the desk. Three decisions the owner
made with it:

- **Only the owner may discount.** Enforced in the Server Action — the same place the catalogue's
  write rule lives (AD-46) — because it is an authorisation question, not a domain one: the ledger's
  job is to make the arithmetic true, not to know the studio's staffing. A discount from anyone else
  is **refused, not dropped**; dropping it would record the sale at full price with less money
  against it, which is the exact bug this exists to prevent. Reception sells at the list price.
- **The reason is optional**, defaulting to `gift`. The one exception is not ours: `manual` requires
  a note in the DOMAIN (I-36 — "a discount without a reason is a hole"), so the form offers that
  reason only together with the note.
- **The line keeps the LIST price.** Collapsing the discount into a lower `unitPrice` would settle
  the sale just as well and lose the fact that a discount was ever given. Gross stays ₺5.000, the
  discount stays its own ₺800, and "we came down on the price" never becomes indistinguishable from
  "we sold a cheaper package". A discount is an AMOUNT, never a percentage re-evaluated later (I-34).

History was checked before shipping it: five open balances, none of them a disguised discount, and
**zero discounts recorded in the system's entire history** — the rule was born with the price rise
rather than papering over anything.

**OR-33 · The door observes; the member declares. They are never added together.** (2026-08-06) The
member app now lets her tick off each exercise in her programme day and finish the day, with sets,
reps, weight and a note. That is a SECOND "I trained" signal beside the one the studio already has —
`member.checked_in`, written at the door — and the two will disagree constantly: she trains and
forgets to tick; she ticks at home.

So they are separate events, separate counters, and never summed (#11 — a presumption is never
written down as an observation):

- **check-in = the studio's observation.** Attendance, occupancy, continuity, the churn signal, and
  every renewal decision read from this and nothing else.
- **`workout.day_completed` = the member's declaration.** Programme progress only.

They meet in exactly ONE place: the desk's adherence view, side by side and labelled, because the
GAP is the signal. "Six workouts ticked, nine days since she was last in the building" is a phone
call; summing them would destroy the only thing worth knowing.

Three decisions the owner made with it:

- **The cycle is walked in order** — 1 → 2 → 3 → 1, no skipping and no repeating the day she just
  did (*"sıralama atlamaya izin yok"*). Refused in the DOMAIN, not by hiding buttons: `nextDayOrder`
  is derived from her completed logs rather than stored, so it cannot drift and a replayed request
  cannot jump ahead.
- **The programme's numbers are placeholders, not values.** An untouched field stores `null`, meaning
  "done as prescribed" — the common case costs zero taps, and only a DIFFERENCE is recorded.
- **The note is read by the trainer, and she is told so** under the field. A note she believes is
  private and a note she knows Işıl reads are different notes.

**What the member is never shown is what she MISSED.** No "bu hafta sadece 2 gün geldin" — it reads
as an accusation to someone who had a reason the app cannot know, and the app she feels judged by is
the one she stops opening. Only what has accumulated ("3. turdasın · toplam 11 antrenman"). The gap
belongs on the staff screen, where a human can pick up a phone. Same rule as the motivation line.

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

**OR-28 · The PAYTR token signs what it sends, and `debug_on` stays on.** (2026-08-05) Sanal POS
refused every attempt with "PAYTR: paytr_token_failed". PAYTR was fine — live mode, valid credentials.
The token is an HMAC over fields we also post, and for a member with **no e-mail address** the hash
signed `''` while the body carried a placeholder. A token PAYTR cannot verify, so **no member without
an e-mail could ever pay by card at the desk.**

The reason it took an evening rather than a minute: `debug_on` was tied to test mode, so in live mode
PAYTR answered a rejected token with a **zero-byte body** — no status, no reason — and our code turned
that into one generic sentence. `debug_on` is now always `'1'`. PAYTR advises `'0'` in production; the
advice is about error text returned TO THE MERCHANT, we consume that server-side and never render it,
and the alternative is an empty reply that makes every failure look identical. **If you ever see a
PAYTR failure with no reason again, that flag has been turned back off.**

The rule this leaves behind: **any field inside a provider hash must be computed once and used in both
places.** The Link flow already carried this lesson in a comment; POS did not, and now there is a test
that recomputes PAYTR's hash from the body actually posted — so a mismatch in *any* field fails, not
just the one we thought of.
