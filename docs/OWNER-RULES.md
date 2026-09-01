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

**OR-31 · One price. Cash, transfer and card are the same number.** (2026-08-06) — **superseded for
Fitness by [OR-38](#or-38); still in force for Pilates, hybrid and PT.** The studio used to
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


<a id="or-38"></a>
**OR-38 · Fitness has two prices again, and the gap is a number, not a rule.** (2026-08-18) The
August campaign prices the three fitness packages differently in cash and on the card: the gaps are
₺1.000, ₺1.250 and ₺2.500 — 11,8 %, 9,8 % and 12,8 %. Neither a fixed amount nor a percentage fits,
so no category rule can express it, and OR-31's zeroed mechanism cannot carry it.

So a product may now carry **its own cash price** (`product.cashPriceInKurus`, editable in Paketler ›
ürün formu, empty by default). When it is set, `priceInKurus` is the **card** price and the field is
the cash one; when it is empty the product is unchanged and the category rule still derives the card
price from the base. `productPrices()` is the single place that knows which arrangement applies, and
every surface reads it — desk sale, mobile app, marketing site, public price API, WhatsApp assistant.
A product with one price returns both figures equal, so those surfaces keep showing one number.

**The desk sale form pre-fills the CASH price** and adds the difference back for a non-cash method.
The alternative — pre-filling `priceInKurus` — would have overcharged every cash sale of a fitness
package by the campaign gap on the day the prices changed.

**Instalments are still the bank's business (OR-31), with one exception the studio pays for itself:**
12 Aylık is sold as *peşin fiyatına 3 taksit* — the member pays no vade farkı and the price does not
change. 3 and 6 Aylık go to six instalments with the vade farkı applied by the payment institution.
The interest-free arrangement lives in the PAYTR merchant panel (Peşin Fiyatına Taksit + Alt Limit),
not in this repository — **owner confirmed it configured and live on 2026-08-18**. The studio's own
`maxInstallments` was raised 3 → 6 so the six can be offered at all.

**Nothing in this repository can verify that setting, and nothing will warn you when it changes.** It
is the one part of the advert's promise that lives outside the system: if somebody switches it off in
the PAYTR panel, the checkout quietly starts quoting a vade farkı on a package advertised without
one, and the first sign will be a member arguing at the desk. Whoever ends the campaign should turn
it off deliberately, in the same hour they empty the AI's campaign note.

**What the assistant is told, and where it comes from.** Prices are read live from the catalogue, as
always. What to *do* with them — push 12 Aylık, name the interest-free instalments, mention limited
capacity once without pressure, offer remote registration — is owner-editable text in Ayarlar › AI
Ayarları › **Güncel kampanya**, and it deliberately contains **no numbers**: a price repeated there
would be a second source of truth that goes stale the day the owner edits the first. When the
campaign ends the owner empties that one field; nothing is deployed.

<a id="or-39"></a>
**OR-39 · A legal text is versioned, and a version is never edited in place.** (2026-08-18) Every
contract, notice and consent text carries a version string in `apps/web/src/lib/legal.ts`. When a
customer accepts one, the version is what gets stored — on the payment intent at acceptance, on the
member as `legalConsents` at fulfilment.

**Why it is a rule and not a convention.** A consent that does not name a version proves nothing.
"She accepted the terms" stops meaning anything the moment the terms are edited: the text she agreed
to no longer exists anywhere, and the record points at whatever is current. So changing the wording
of a legal page means bumping its version **in the same commit**, and a version that somebody has
already accepted is frozen — you add a new one, you do not correct the old one.

**What the texts may say.** Only what the software actually does. Before these pages were written the
codebase was audited against the brief, and three things in the brief were not true of the system:
there is no TC kimlik field, no address field, and no accounting or e-fatura integration. None of
them appear in the KVKK notice. The cancellation window is stated as the **6 hours the code
enforces**, not the 12/6 time-of-day split the brief asked for — the owner chose to match the text to
the system rather than promise a behaviour that does not exist yet (*"metne 6 saat yaz, kodu
değiştirme"*). If that rule ever changes, the code changes first.

**Reformer 16 and 24 Ders are named in the contracts** at the owner's instruction, though both are
currently deactivated and carry no price. They cannot be sold until he sets prices; the Ön
Bilgilendirme Formu is generated per package, so it will be correct the moment they are.

<a id="or-40"></a>
**OR-40 · `pnpm check` cannot see a `'use server'` violation. Run the real build.** (2026-08-18)
App Hosting rejected every push for two hours and nine minutes while the gate stayed green:
`SEGMENT_LABEL` and `SEGMENT_KEYS` had been exported from a `'use server'` file, which may export
**async functions and nothing else**. TypeScript accepts it, eslint accepts it, dependency-cruiser
accepts it, and `next build` fails with *"A 'use server' file can only export async functions, found
object"*.

The cost was not the outage — the panel kept serving the old revision — it was the **silence**. A
notification fix shipped that morning never went live, the owner tried to use it, and the failure
looked like a bug in the feature rather than a deploy that had never happened. OR-15 already said the
gate does not run `next build`; this is what that costs in practice.

**So: touch a `'use server'` file, run `pnpm --filter web build` before pushing.** Values belong in
`lib/`, actions belong in `server/actions/`, and the two do not mix.

<a id="or-41"></a>
**OR-41 · Both payment providers stay. The owner picks one, and everything reads that pick.**
(2026-08-19) TAMI was approved and PAYTR is not being retired. Ayarlar → Ödeme Sağlayıcısı Ayarları
carries the choice; `paymentProviderFor` resolves it and every write path goes through that one
function. A payment intent records the provider it was **minted under**, so switching providers never
strands a payment already in flight — the link a member is holding still completes on the provider
that issued it.

**One refusal is load-bearing and stays:** TAMI cannot be activated without the JWK (`K`/`Kid`).
Without it a checkout still mints and she still pays — we simply cannot establish that she did, so
nothing credits her. The settings action refuses that state rather than warning about it, because a
warning is something a tired person clicks past at 19:00 on a Friday.

**TAMI has no sandbox for us.** Production credentials answer `errorCode 4003` against the sandbox
host; the merchant panel issues production keys only. TAMI testing therefore happens in production
with small amounts, and that is a deliberate accepted cost, not an oversight.

<a id="or-42"></a>
**OR-42 · A failure the user cannot see is worse than the failure.** (2026-08-19) Four separate
silences cost an afternoon, and none of them were the feature that was being built:

- `<Toaster />` was mounted only in the `(staff)` layout, so every error on the two **customer-facing
  payment pages** was raised and rendered nowhere. A buyer whose checkout was refused saw a page that
  simply did nothing.
- A refused checkout logged nothing server-side, and the payment adapter reduced the provider's
  answer to an HTTP status while discarding a body that named the actual cause.
- `successUrl` pointed at a page that had never existed, so members who paid by card were redirected
  to the staff login — live on PayTR for weeks, noticed only by accident.
- The way into the payment settings was a button named after one of the two providers behind it.

**So: any surface a CUSTOMER can reach must be able to show an error.** A public page that calls
`toast.error` without a `<Toaster />` is not a small bug — it is a payment failure with no symptom.
And an adapter that hides the provider's own error code makes every future failure a research
project. When something "does nothing", suspect the reporting before the logic.
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

**It also applies AFTER the sale.** (2026-08-07) The sale-time field could not reach the commonest
case at the desk: reception sells at list, takes what the member brought, and the rest is agreed away
afterwards. Within a day of shipping, a ₺5.000 package with ₺4.200 collected was sitting at ₺800
"debt" for exactly this reason.

Üye › Paket › Düzenle now offers **İndirim Uygula** beside Tahsilat Al, owner-only, and it does the
same thing the sale-time one does: the sale keeps its `gross`, gains a discount, and settles. Two
refusals matter — a discount **larger than what is still owed** (forgiving money already in the till
is a REFUND, a different act with cash going back), and `manual` with no note.

Editing the agreed price down still works and still closes the balance — but it destroys two facts
while doing it: what the package costs, and that anything was given away. **A studio that cannot
count what it discounted cannot decide whether to keep doing it.**

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

**OR-34 · The turnstile is a door, not a decider.** (2026-08-07) The studio is fitting a Perkotek
S150 — a dry-contact turnstile with no reader, no network and no opinion: it waits for "open" and
turns once. Every decision stays here.

**How it works.** A small screen beside the arm shows a six-digit code that the device asks us for
every few seconds. The member scans it with her phone, the app asks whether she may cross, and we
answer from her packages, her freeze and her balance. The owner chose this over a reader because it
is what the gyms he uses do, and because the member already knows the gesture.

The rules that make a screen in a public corridor safe, all of them in the DOMAIN rather than in a
screen that happens to refresh:

- **The code lives 45 seconds.** A photographed code must be worth nothing a minute later.
- **It is single use**, spent in a TRANSACTION — two phones pointed at the same screen in the same
  second produce one winner and one `qr_used`. Read-then-write would let both in.
- **It is bound to its device.** A code minted at one door never opens another.
- **The code is spent BEFORE the check-in is recorded.** If the two race, the failure we want is "the
  door did not open" — one rescan — never "two people crossed on one code".

**It emits `member.checked_in`, not a new event type.** The architecture wrote this rule down before
the hardware existed: *"a reception tap, a QR scan, and a 2027 turnstile all emit
`member.checked_in` — `method` is metadata"* (AD-18). `method: 'device'` had sat unused since the
first commit; today it is used. The same `recordCheckIn` runs, so occupancy has one arithmetic and
one debounce.

**The device is a principal** (#5): its own id and secret, `actor: { type: 'device' }` on every
crossing. When the log says the door opened at 07:14 it names the door, not whichever receptionist
was signed in. Only the secret's SHA-256 is stored — a key readable from the database is a key
everybody who reads the database has, and this one opens a physical door.

**Direction: the arm wins.** Presence infers it (inside ⇒ leaving), but the S150's direction output
is wired in, and what the arm DID beats what we assumed she meant. That wire is what repairs a
drifted presence.

**Reception can open it by hand** for a guest, a Multisport visitor or a dead phone. That records
*who opened it* and *nothing about a member* — a guest is not a check-in, and pretending otherwise
would put a stranger into occupancy and into somebody's attendance.

**Known limit, accepted by the owner:** the code is on the door but the identity is on the phone, so
a member can hand her phone to somebody. A reader would move identity through the turnstile and close
that. The mitigation is the 45-second life; the decision was: the gyms do it this way, and it works.

**OR-35 · A training programme belongs to fitness and PT members only — enforced on the WAY IN.**
(2026-08-08) A pilates-only member trains in a class, led by a trainer; what she wants tracked is her
MEASUREMENTS. The owner settled this on 2026-08-06 and it shaped the member app: she never meets the
word "Antrenman", not as a tab and not as an empty state.

But it was only ever enforced where the data is DISPLAYED. The app hid the tab while the panel
happily assigned a programme anyway — and one was, to a member holding a single Reformer package.
**A rule that lives only on the read side is not a rule; it is a preference the next screen ignores.**

Now one function answers it, and both sides call it: `mayHaveProgram`. The two doors that create a
programme (`createProgramAction`, `assignTemplateAction`) REFUSE, and the panel hides the buttons and
says why. Hiding alone would not have been enough — a button that is merely absent is a button a
second screen still presses.

**The escape hatch is deliberate:** a member who already HAS a programme keeps it and may be given
another. Nothing granted is taken away by a rule written afterwards.

The audit that followed found six programmes without a fitness/PT package, and only **two** were the
bug: four belonged to fitness members whose package had EXPIRED, and their programme must be waiting
when they renew. The two real ones were **archived, never deleted** — deleting would erase the
evidence of the bug being fixed.

**OR-36 · Nothing may happen to Pilates Fitness by Işıl's DATA or her WORKING CODE.** (2026-08-09)
Said at the start of the productisation work. That studio retired its old system on 2026-07-27; this
panel is the only one it has, and every member, package, credit and payment it has recorded since
lives in one place. Productisation is for the *second* customer — the first customer's records and
her working day cannot be its cost.

The rule is about **harm, not motion.** Shipping is normal and expected; regression and data damage
are not. Concretely:

- **Her data is never written to for our convenience.** No setup script, no break-glass, no console,
  no migration, no batch, no "small correction" to make a new feature fit. Reading is fine and
  encouraged. Corrections to her records happen only when *she* needs them, through the domain, with
  a `reason` — never as a side effect of platform work.
- **Nothing of the platform's is attached to her settings.** This is why `studyoasistan.com` was NOT
  added to the nightly watchdog: that document lives under her studio, so monitoring the platform's
  own domain would have meant writing into a customer's configuration (DEBT-042).
- **What works today still works tomorrow.** A change made for another customer must not alter her
  panel's behaviour. New behaviour sits **behind a per-studio setting** whose value for `retro` is
  empty, so her side keeps doing exactly what it did.

**Deploying is not the risk; breaking is.** One code base was chosen deliberately
(`PRODUCT-ROADMAP.md` §2), so Faz A's code — the per-studio WhatsApp number, the e-mail sender,
`studio:new` — runs on her panel the moment it ships. That is fine, and reading this rule as "never
deploy" is reading it wrong. The existing deploy discipline still applies for its own reasons: at
night when the studio is open, because every deploy breaks whatever tab is already loaded (see the
Traps below), and "did it deploy?" is answered from Cloud Run's traffic split, never a guess
(OR-17). On a day the studio is closed, that constraint simply is not in play.

If a piece of Faz A cannot be built without touching her data or changing her behaviour, it stops
and the owner decides.

**OR-37 · A payment is NEVER matched to a passive subscription.** (2026-08-13) Said in these words
after it cost a morning: *"pasif aboneliğe hiçbir zaman link ve sanal pos ödeme eşleştirilmez."*

**What happened.** A member was sold a hybrid at 10:10 and a payment link went out. At 10:14
reception cancelled the packages — the member had changed her mind about something — and at 10:15
sold the same hybrid again, with a fresh link. At 10:18 PAYTR reported the second link paid, and the
money landed on the FIRST sale: the one whose packages no longer existed. Her live packages sat on
an unpaid sale, so a member who had just paid ₺5.000 showed as owing ₺5.000.

**Nothing was broken in the callback.** It did what it was written to do — `collect` clears the
member's debt oldest-first, and both sales were open. The gap is that **cancelling a package does
not cancel its sale**, so reception's entirely reasonable "cancel and redo" left an orphan: an open
sale with no live packages, older than the real one, first in line for any money that arrived.

**The rule.** Money never settles against a sale whose packages are all cancelled — not from a
payment link, not from Sanal POS, not from any automatic matching. If the only open sale is such an
orphan, the payment stays unallocated and says so, which reception can see and act on. An
unallocated payment is a question; money attached to a dead sale is a wrong answer that looks
right — and it looks right on the member's screen, which is where she reads it.

**How it is enforced, since 2026-08-14.** A payment link created for a package now CARRIES that
sale. `createPackageLinkSaleAction` passes the real `saleId` from `sellPackage` into the payment
intent — it used to fabricate a `sal_<random>` that matched nothing, which is why the callback had
nothing to go on and could only guess. Both callback copies read it and pass `allocateTo` to
`collect`, which settles that sale and stops. `allocateTo` had been declared on `CollectInput` for
some time and was never implemented: a caller could pass it and silently get oldest-first anyway.

A named sale that is cancelled, or is not this member's, is **refused** (`allocation_target_invalid`)
rather than falling back to oldest-first — the fallback is the bug. A surplus stays unallocated as
member credit (I-33) instead of spilling onto another sale.

Unchanged on purpose: a collection with NO named sale still pays oldest debt first, because that is
what reception means by "bakiyesine yaz". Covered by
`packages/core/src/modules/finance/application/collect-allocation.test.ts`, refusals included.

⚠️ **The residual hazard is manual collection.** A link now cannot land on an orphan, but reception
collecting from Cari Hesap by hand still pays oldest-first and an orphan sale is still first in line.
Closing that needs the decision below.

**What this does not decide.** Whether cancelling the last live package should also cancel its sale
is the deeper question and is deliberately left open: a sale can carry several packages (a hybrid is
one sale, N entitlements) and non-package lines, so "the sale is dead now" is not always true when
one component is cancelled. Until that is decided, the orphans remain — which is one more reason the
suspicious-transaction screen the owner asked for on the same day has something real to show.

---

**OR-47 · Eğitmen sisteme giriyor: üyenin ADI ve ANTRENMANI evet, TELEFONU ve PARASI hayır.** (2026-08-30)

Owner eğitmenleri sisteme aldı. Görecekleri: rezervasyon ajandası, üyelerin ad-soyadı, antrenman
bilgisi (ekleme/değiştirme/görme), ölçüm, ve **aktif** paket. Görmeyecekleri: **telefon**, **geçmiş
paketler**, ve stüdyonun parasına dair her şey — kasa, cari hesap, ödeme, fiyat.

**Resepsiyonun üye kartı bu ekran OLAMAZ, ve bu bir tercih değil.** `/members/{id}` başlığında
telefonu, sekmelerinde Cari Hesap · Cüzdan · Belgeler · paket geçmişini taşıyor. O kapıyı eğitmene
açmak, owner'ın "göremesin" dediği her şeyi aynı hareketle vermek olurdu. Bu yüzden ikinci ve dar bir
ekran açıldı: `/trainees`.

**Sınır ekranda değil, sorguda.** `server/trainee-query.ts` göstermediği alanı **okumaz** — telefon
tarayıcıya hiç gitmez, sayfa kaynağında da ağ sekmesinde de yoktur. CSS ile gizlenen telefon,
gizlenmiş telefon değildir. `server/trainee-boundary.test.ts` bunu yapısal olarak tutuyor: bu
dosyalara `phone`, `balanceDue`, `priceAgreed`, `payment` ya da herhangi bir `Kurus` girerse
`pnpm check` düşer. Kural, altı ay sonra "eğitmen ders değişikliği için arasın diye telefonu da
koyalım" cümlesini durdurmak için var — kimsenin kasım ayında hatırlamadığı kural, aralıkta yoktur.

**Hangi üyeler: HEPSİ.** (owner'ın kararı; alternatif "sadece kendi derslerindekiler" idi.) Dersi
devralan hoca anında çalışabiliyor. Bedeli açıkça söylendi ve kabul edildi: stüdyonun üye **isimleri**
artık üç hesapta daha okunabilir. Para ve telefon değil — isim.

**Owner'ın panelinde yok, kasten.** Owner'da zaten zengin olan `/members` var; ikinci bir "Üyeler"
aynı odaya iki kapı demek. Eğitmen görünümünü, Derslerim'i kontrol ettiği gibi kendi eğitmen hesabıyla
girerek görür (2026-07-16 düzeni).

Yazma yetkisi zaten hazırdı — program, şablon, ölçüm action'ları 7. Fazdan beri
`['owner','trainer','platform_admin']`. Eksik olan yetki değil, **ekrandı.**

---

**OR-48 · Toplu gönderim ÖNİZLEMESİZ yapılmaz. Ve her sayı açılabilir olmalı.** (2026-08-31)

Owner Stüdyodan ekranına iki şey istedi, ve ikisi de aynı şikâyetin iki yüzü: **rakamı görüyorum,
insanları göremiyorum.**

**1 · "Gönder" artık göndermez.** Eskiden "173 üyeye gönder" düğmesi basıldığı anda 173 geri
alınamaz mesaj yolluyordu; arada duran tek şey, owner'ın ekranda zaten gördüğü sayıyı tekrar eden bir
`confirm()`'di. O bir kontrol değildir. Artık düğme **kimin ne alacağını sunucuya sorar**, gösterir,
ve gönderim ikinci ve bilinçli bir onaydır.

**Önizleme kuralları yeniden yazmaz — aynı fonksiyonları çağırır.** Kitleyi `resolveAudience` ile
çözer (gönderimin kullandığının aynısı), kanalları `selectChannels` ile hesaplar (pipeline'ın saf
fonksiyonu), aynı `marketing` kategorisi ve aynı kanal geçersiz kılmasıyla. Kuralın ikinci bir kopyası
olsaydı, ilk değişiklikte önizleme **var olmayan bir gönderimin** önizlemesine dönerdi — ve hiçbir şey
kırılmadığı için kimse fark etmezdi. `engagement-preview.test.ts` bunu yapısal olarak tutuyor.

**Şaşırtan sayı toplam değil, erişim.** 173 üyeye "Sadece e-posta" seçilirse **23 kişiye** gider,
çünkü 23'ünün e-posta adresi var. Eski düğme 173 diyordu ve stüdyonun bunu öğrenmesinin bir yolu yoktu.
Önizleme kanal kanal kaç kişi + ulaşılamayanların **sebebini** gösterir (izin yok · adres yok · üye o
kanalı kapatmış), çünkü bastırılmış bir kampanya sessiz olamaz.

**2 · Her kitle sayısı tıklanabilir.** "Sürekli iptal edenler (9)" — dokuz kim? Açılamayan sayı,
üzerine hareket edilemeyen sayıdır.

**3 · Elle üye grupları.** Buradaki her kitle bir KURALDAN hesaplanır; bazı kitlelerin kuralı yoktur
(Salı 10:00 grubu, arkadaşını getirenler). Onlar elle seçilir ya da hiç var olmaz. Gruplar
segmentlerden **ayrı satırda** durur, çünkü ikisi farklı şeydir: segment her açılışta yeniden sorulan
canlı bir soru, grup donmuş bir liste. Bayatlamış bir segment hatadır; bayatlamış bir grup sadece
güncellenmemiş bir listedir. Ayrılan üye gönderimden **düşer**, ve ekrandaki sayı da onunla düşer.

---

**OR-49 · Personele davet linki ÜRETİLİR, e-postayla gönderilmez.** (2026-08-31)

Üç eğitmen hesabı haftalardır duruyordu ve **hiçbiri hiç giriş yapmamıştı**. Sebebi kayıt değil,
onboarding: bir meslektaşı sisteme sokmak, owner'ın geçici bir şifre uydurup sözlü iletmesi demekti.
Üstelik üç adresten ikisi henüz mail almayan `@pilatesfitnessbyisil.com` kutuları — Firebase'in kendi
"sıfırlama e-postası gönder" akışı daveti boşluğa postalardı.

Bu yüzden link **üretilir, gönderilmez**: owner kopyalar ve personeliyle zaten nasıl konuşuyorsa
öyle iletir. Kutunun çalışması gerekmez.

**Geçici şifreden daha iyi olmasının sebebi kolaylık değil: owner şifreyi hiç öğrenmez.** Paylaşılan
geçici şifre aylarca yaşar, tekrar kullanılır, ve bir WhatsApp konuşmasında öylece durur. Burada
meslektaş kendi şifresini belirler ve link kendiliğinden geçersizleşir.

Kapılar: sadece owner · sadece **bu stüdyonun** personeli (yoksa istenen her uid için link basardı) ·
**pasif hesaba link yok** — link erişimdir, pasif meslektaş tam da erişmemesi gereken kişidir.

---

**OR-50 · Dondurma ileri tarihe planlanabilir. Hak aşılabilir — ama sebepsiz aşılamaz.** (2026-08-31)

Owner iki şey istedi:

**1 · Başlangıç ve bitiş tarihi.** *"O tarihlerde dondurma işlemi yapabilsin."* Üye 31 Ağustos'ta
"5–15 Eylül yokum" diyor. Eskiden masa onu ancak BUGÜN durdurabiliyordu; bunu onurlandırmanın tek
yolu 5 Eylül'de birinin hatırlamasıydı — yani olmuyordu, ve üye gelmeyeceği söylenen günlerin parasını
ödemeye devam ediyordu.

**Planlanan dondurma, dondurma DEĞİLDİR.** Üye pencere başlayana kadar **aktif** kalır ve derse
gelebilir. Hiçbir tarih planlama anında oynamaz — uzatma yine çözülünce, üyeliğin gerçekten durduğu
günler kadar ödenir. Üç ayrı olay var çünkü üç ayrı günde üç ayrı şey oluyor: `freeze_scheduled`
(masa pencereyi kaydetti) · `frozen` (o gün geldi ve durdu) · `freeze_schedule_cancelled` (üye
vazgeçti, hiçbir şey donmadı). Bunları tek olaya indirmek, kaydın stüdyonun NE ZAMAN hareket ettiği
konusunda yalan söylemesi olurdu.

**Süpürücü gecikirse pencere yine söz verilen günde başlar**, süpürücünün uyandığı günde değil.
Stüdyo söylediğini borçludur, zamanlayıcısının becerdiğini değil.

**2 · Hak aşımı artık sessiz değil.** İnisiyatif 31 Temmuz'dan beri serbestti ([[OR-21]] hattı) ama
kayıt sadece KAÇ gün aşıldığını tutuyordu, NEDEN'i hiç tutmuyordu. Artık hakkı aşan işlemde zorunlu
bir sebep kutusu çıkıyor ve ekran ne olacağını açıkça yazıyor: *"Bu işlem paketin 7 günlük dondurma
hakkını 3 gün aşıyor. Sistemde dikkat çekecek ve kayda geçecektir."*

**Sebep DOMAIN'de zorunlu, formda değil** (`freeze_override_reason_required`). Sadece ekranın
uyguladığı kural, aynı action başka bir yerden çağrıldığı gün biter.

**Sebebin kendisi olaya YAZILMAZ, duruma yazılır.** `note` ile aynı sebep (#6): "ameliyat sonrası"
kalıcı bir kayda düşerse kimse geri çıkaramaz. Olay `overageDays` taşır — owner'ın gerçekten
soracağı şey odur: *"kendi şartlarımızı ne sıklıkla, kimin için aşıyoruz?"*

**Kural iki yönlü.** Pencerede dersi olan üye dondurulamaz — ve pencere planlandıktan sonra o
aralığa ders de alınamaz. İkincisi ilk turda atlanmıştı: owner "bilerek yapmadığın şeyi anlamadım"
diye sorunca anlatmak, ucuz yolu görmemi sağladı. Pencere entitlement'ta **iki biçimde** duruyor —
kayıt olan tarihler, ve kıyaslanabilir olan anlık karşılıkları. Çevrimi saat dilimini zaten bilen
Server Action bir kez yapıyor; `isEligibleForService` iki sayı karşılaştırıyor ve saat diliminden
habersiz kalıyor. **Hiçbir çağrı yeri değişmedi** — rezervasyon, bekleme listesi, tekrarlayan
rezervasyon ve üye uygulamasının ajandası dördü de otomatik miras aldı.

Aynı bilginin iki kopyası, ve gerekçesi hız değil **doğruluk** — CLAUDE.md'nin "mimari" ile "kılık
değiştirmiş borç" arasına çektiği çizgi tam burada. Ayrıntı ve kanıt: [`DEBT-037`](DEBT.md).

---

**OR-51 · Toplu gönderim DURDURULABİLİR olmalı, ve nerede kaldığı görünmeli.** (2026-08-31)

Resepsiyon pazartesi motivasyon mesajını **tüm listeye** gönderdi, bekledi, uzun sürdüğünü düşünüp
"iptal etti" — yani ekranı kapattı. **İptal edecek bir şey kalmamıştı:** gönderim 16:43:18'de
başlamış, 16:46:56'da bitmişti. 154 üyeye WhatsApp gitti, 174 uygulama içi, 20 e-posta; tek bir hata
bile yok.

İki ayrı kusur, ve ikincisi daha sinsi: **(1)** durdurma yoktu, **(2)** durdurulacak bir şey olup
olmadığını öğrenmenin de yolu yoktu. Ekranı kapatmak sunucudaki döngüyü durdurmaz — gönderim hiçbir
zaman o sekmede değildi.

**Çözüm: gönderim kendi kaydını açar.** `engagementRuns/{opId}` belgesi hem **kumanda** hem
**kayıttır**: döngü ilerledikçe oraya yazar ve her beş üyede bir "durduruldum mu" diye okur. Ekran o
belgeyi 1,5 saniyede bir sorar; **Durdur** ise `cancelling` yazar. Sekme kapansa gönderim devam eder
ve ekran tekrar açıldığında onu bulur.

**Durdurma ÖLDÜRMEZ, RİCA EDER.** Uçmakta olan bir mesaj geri alınamaz — mesaj ya çıktı ya çıkmadı.
Ekran "durduruldu" demeden önce döngünün gerçekten durmasını bekler; arada "durduruluyor…" der.
*Bitmeden bitti demek, bu ekranın söylememek için var olduğu yalandır.*

**Sonuç sayıyla söylenir:** *"Gönderim durduruldu — 134 üyeye gitti, 40 kişiye gönderilmedi."* Kuru
bir "durduruldu", cevaplaması gereken soruyu davet eder.

Beş üyede bir kontrol bilinçli: her üyede okumak, mesaj başına bir okuma daha demek — cevabı neredeyse
hep "hayır" olan bir soru için gönderim maliyetini ikiye katlar. Üye başına ~1 saniyede bu, düğmeye
basmakla durması arasında ~5 saniye bırakır.

**Bilinen sınır:** gönderim hâlâ tek bir uzun istek. 174 kişi 3,5 dakika sürdü; liste 600'e çıkarsa
istek zaman aşımına uğrayabilir. O gün olduğunda **yarım kalan gönderim sessiz olmaz** — kayıt
belgesi `running`'de asılı kalır ve nerede durduğunu söyler. Gerçek çözüm (kuyruk + arka plan işi)
o gün gelir; bugün gereken şey görünürlüktü.

---

**OR-52 · Bitiş tarihi ileri alınan paket CANLANIR. Kendisiyle çelişen kayıt yazılamaz.** (2026-08-31)

Işıl iki üyenin bitiş tarihini 7 Eylül'e aldı, kaydetti — ikisi de **pasif** kaldı. Biri kapıda QR
okuttu, sistem "pasif" gösterdi.

**Sebep:** `decideAmend` tarihi taşıyordu, **duruma hiç dokunmuyordu**. Başka bir yol da yoktu:
`decideReactivate` yalnızca `cancelled` kabul ediyor ("expired terminaldir"), `decideExtend` aktif
olmayanı reddediyor. Sonuç: **kendisiyle çelişen bir kayıt** — "süresi doldu", ama bir hafta daha
geçerli — ve rezervasyon yapamayan iki ödeyen üye.

**Asıl kusur eksik canlandırma değildi.** Hiçbir kuralın üretemeyeceği ve hiçbir ekranın
açıklayamayacağı bir durumu üreten bir kaydın **kabul edilmesiydi.**

**Kural, hangi alanın değiştiğine değil ORTAYA ÇIKAN DURUMA bakar.** "Süresi doldu" ama tarihi
gelecekte olan bir kayıt, oraya nasıl geldiyse gelsin çelişkilidir; sebebi yazılmış her bilinçli
düzenleme onu onarmak için doğru andır. (İlk yazdığım hâli "validUntil değişti mi?" diye soruyordu —
o zaman **zaten bozuk olan kayıt** hiçbir zaman onarılamazdı, çünkü aynı tarihi tekrar kaydetmek bir
değişiklik değildir.)

**KREDİLİ paket REDDEDİLİR.** Süre dolarken kalan dersler yanar (`decideExpire`). Sadece tarihi ileri
almak, **dersi olmayan "aktif" bir paket** bırakır — reddetmekten kötüdür, çünkü düzelmiş görünür ve
kimse bir daha bakmaz. Ekran ne olduğunu söyler ve ne yapılacağını önerir.

**Canlanma AYRI bir olaydır** (`entitlement.reactivated`), `amended` içinde bir alan değil. "Sönmüş
bir üyeliği ne sıklıkla geri getiriyoruz?" birinin soracağı sorudur; fiyat düzeltmeleri ve yazım
hatalarının arasına gömülürse bir daha ayrıştırılamaz.

Canlıdaki iki kayıt elle değil, **domain üzerinden** onarıldı — sebebi olayla birlikte yazıldı
(`tools/migration/revive-expired-with-future-date-2026-08.ts`). Konsoldan elle düzeltme durumu doğru,
kaydı sessiz bırakırdı; oysa bir üyeliğin neden geri döndüğünü sonradan yalnızca kayıt söyleyebilir.

---

**OR-53 · Paketi olmayan üyeye TURNİKE açılmaz. Ama çıkış asla engellenmez.** (2026-08-31)

Owner sordu: *"pasif olan üye qr okutabiliyor mu ya"* — evet, okutabiliyordu. `decideCheckIn` yalnızca
şubenin açık olmasına, "zaten içeride/dışarıda" durumuna ve QR'ın geçerliliğine bakıyordu; paketi
hiç sormuyordu. Karar: **paketi olmayan pasif sayılır**, kol dönmez, ekran resepsiyona yönlendirir.

**Üç şey bilerek böyle:**

**1 · Yalnızca GİRİŞTE.** Çıkışta asla sorulmaz. İçeride olan biri paketi bittiği için içeride kalamaz —
o bir kural değil, bir arızadır. Dersi sırasında süresi dolan üye tam çıkarken kapıda kalırdı.

**2 · Yalnızca TURNİKEDE.** Resepsiyon ve kiosk aynı kontrolden geçmez: paketi olmayan üye ödemeye,
konuşmaya, bakmaya gelmiş olabilir ve **insan karar verir.** Kapı karar veremez, o yüzden kapı hayır
der. `recordCheckIn` bilerek dokunulmadan bırakıldı — girişin KAYDI hâlâ mümkün, çünkü kişi gerçekten
girdiyse bunu yazmamak başka bir yalan olurdu.

**3 · Geçerlilik penceresi de sayılır.** `listActiveByMember` yalnızca `status` bakar; **ileri tarihli**
bir paket (7 Eylül'de başlayan) bugün canlı DEĞİLDİR ve bugün kapıyı açmaz. Gamze'nin durumu tam
buydu; testte de o şekilde yazılı.

**Ret KODU HARCAMAZ.** Üye resepsiyona uğrayıp paketini yeniletince aynı ekranı okutabilmeli. Ama bu
bir yan etki doğurdu: ekran geçişleri *"kod kullanıldı mı?"* diye sorarak öğreniyor, yani harcanmamış bir
kod ekran için **hiç olmamış bir okutma** demek — üye kapıda hiçbir şey görmez, turnike sessizce
açılmaz ve bozuk sanılırdı. Bu yüzden cihaz başına **tek bir "son ret" kaydı** tutuluyor: 20 saniye
yaşar, ekran bir kez gösterir ve siler. Kodun kimliğine alan eklenmedi — ret geçici bir arayüz
sinyalidir.

**Ekranda suçlama yok:** *"Merhaba <ad> · Lütfen resepsiyona uğrayın"*. Kapıda kalmış birine "hakkınız
yok" demek hem kırıcı hem işe yaramaz; ne yapacağını söylemek işe yarar. Ses de karşılamadan
farklı (2 bip), böylece üye ekrana bakmadan da anlar.

---

**OR-54 · Süresi dolmuş paketin YANAN hakkı bir derse saydırılabilir — masa açıkça seçerek.** (2026-09-01)

Owner: *"Paket süresi biten üyenin kredisi kalınca bazen Işıl bu üyeye süre de vermeden direkt o
kredisine binaen bir ders rezerve etmek istiyor. Süre vermektense direkt bir ders belirleyip rezerve
etmek daha mantıklı oluyor."*

**Süre eklemek paketi bir ay daha açar; bir ders saydırmak yalnızca o dersi verir.** İkincisi hem
daha az hem daha dürüst.

**AKIŞ (owner'ın sırası):** üyenin bu dersi ödeyebilecek **aktif paketi varsa hiçbir şey sorulmaz** —
rezervasyon normal yolundan gider. Diyalog yalnızca o yol tıkandığında ve gerçekten yanmış hak varsa
açılır; birden fazla paketi olabileceği için hangisine sayılacağı sorulur.

**"Aktif paket" KATEGORİ bazlıdır** (owner kararı). Aktif fitness paketi, pilates dersini zaten
ödeyemez — kategori duvarı. O yüzden soru "herhangi bir aktif paketi var mı" değil, *"bu DERSİ
ödeyebilecek aktif paketi var mı"*.

**Yalnızca `expired`. `cancelled` asla** (owner: *"sadece süresi dolmuş paketleri göster"*). İptal
alınmış bir karardır; listeye koymak onu kazara geri getirmek olurdu.

**Defter: geri ver, sonra harca.** Süre dolarken krediler `expired` kovasına yakılır ve `available`
sıfırlanır — yani "o krediyle rezerve et" aslında **yanmış hakkı geri verip harcamak**tır. Sayaçların
üstüne YAZILMAZ: `expired` azaltılmaz, `restored` bir artırılır. Telafi kaydı, sessiz düzeltme değil
(#9), sebebi `correction` ve notu olayla birlikte durur — *"kendi kuralımızı kaç kez esnettik"*
sonradan cevaplanabilir. **Paket dirilmez, kalan yanık dersler yanık kalır.**

**Kapı bir gevşetme değil, ayrı bir kapıdır.** `honourExpiredCredit` yalnızca masa yolundan ve
yalnızca `entitlementId` AÇIKÇA verildiğinde geçer. Otomatik seçim buraya asla düşmez — sessiz bir
yedek olsaydı süresi dolmuş paketler zamanla normal bir kaynağa dönüşür ve "süre doldu" diye bir şey
kalmazdı. Üye kendi uygulamasından bunu hiç yapamaz.

**Diğer bütün korumalar yerinde:** kontenjan, kategori duvarı, hizmet duvarı, kredinin gerçekten var
olması. Ayrı bir "süresi dolmuş rezervasyon" karar fonksiyonu yazmak, değişmezlerin yanlış
yapılabileceği ikinci bir yer açmak olurdu — aynı `decideBooking` kullanılıyor.

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

---

**OR-43 · Yeni bir ders türü, satılmış hiçbir pakette yoktur.** (2026-08-21) Fit Paket ayrı bir ders
türü olarak açıldı, kabul koşulu (`admission`) da çalışıyordu — ve ders **hiç kimseye görünmedi**.
Sebep kategori değildi: `productSnapshot.serviceIds` satın alma anında donuyor, yani dün açılan bir
ders türü elli paketin hiçbirinde yazmıyor. Üç paketi olan üye bile göremezdi.

Owner'ın kuralı: **bir seans kimi kabul ettiğini açıkça söylüyorsa, paketin "neye karşı satıldığı"
listesi o seansta geçerli değildir.** Beyan varsayılanı geçer. Alternatif — elli üyenin dondurulmuş
paket snapshot'ını toplu güncellemek — reddedildi; dondurulmuş olmalarının sebebi tam olarak bu.

Bunun operasyonel karşılığı: **kabul koşulu güçlü bir anahtardır.** İşaretlenen seans, seçilen
kategorideki *tüm* paketlere açılır. Kutuyu işaretlemek bir tercih değil, bir karardır.

**Ve `admission` yalnızca seans OLUŞTURULURKEN verilebilir.** Var olan bir dersi sonradan açmanın
yolu yok — silip yeniden oluşturmak gerekiyor. Şablonlar da taşımıyor: haftalık üretilen seanslar
kabul koşulunu kaybeder. İkisi de bilinen eksik; owner isterse ayrıca yapılacak.

---

**OR-44 · TAMI en fazla 3 taksit. Daha fazlasını isteyen PayTR linkiyle gider.** (2026-08-24)
TAMI'nin ortak ödeme sayfasında tutar token üretilirken **sunucuda sabitleniyor**, müşteri taksit
sayısını sonra sayfada seçiyor. TAMI teyit etti: *"vade farkına göre değişkenlik gösteren bir taksit
yapımız bulunmuyor"* — yani vade farkını taksit sayısına göre fiyata yansıtmak **teknik olarak
mümkün değil.** Komisyonu stüdyo üstleniyor.

Komisyon: 1 taksit **%2,85** · 2 taksit %5,89 · 3 taksit **%7,95** · 6 taksit %13,47 · 12 taksit %24,32.

Sınır 3'te, çünkü ölçüldü: **6 taksitte kartla satış nakitten AZ kazandırıyor.**

| Paket | Nakit | Kart | 3 taksit net | 6 taksit net |
|---|---|---|---|---|
| Fitness 12 Aylık | 19.500 | 22.000 | 20.251 ✅ | 19.036 ❌ |
| Fitness 6 Aylık | 12.750 | 14.000 | 12.887 ✅ | 12.114 ❌ |
| Fitness 3 Aylık | 8.500 | 9.500 | 8.745 ✅ | 8.220 ❌ |
| Pilates 16 Ders | 7.800 | 8.600 | 7.916 ✅ | 7.443 ❌ |

Kart fiyatındaki marj (%9,8–19) 3 taksidi karşılıyor, 6'yı karşılamıyor. 6 taksit, nakit-kart fiyat
mantığını tersine çevirirdi.

> ⚠️ **Yukarıdaki "net" sütunları KDV'yi hesaba KATMIYOR** ve tek başına okunursa kart satışını
> olduğundan iyi gösterir. Tam tablo [[OR-45]]'te. Sonuç değişmiyor — 3 taksit hâlâ doğru sınır —
> ama gerekçe farklı: komisyon küçük ortak, asıl kalem KDV.

**Sınır TAMI tarafında tanımlı** (Masterpass'te 3'ten fazlası görünmüyor), yani resepsiyonun
hatırlaması gereken bir kural değil. Daha fazla taksit isteyen üye için: paket satarken
**Linkle Ödeme → sağlayıcı: PayTR**. Orada vade farkını ödeme kuruluşu müşteriye yansıtıyor.

**Ayarla oynanmaz.** Ödeme, oluşturulduğu sağlayıcıyla tamamlanır ([[OR-41]] hâlâ geçerli: ikisi bir
arada durur). Stüdyo ayarını ileri geri çevirmek gerekmiyor ve gerekmemeli.

---

**OR-45 · Kartla satış bilerek nakitten az getiriyor. Eşik %80.** (2026-08-25)

Owner'ın kararı, kendi cümlesiyle: *"rekabet zor… ödeme kolaylığına binaen sürümden kazanalım
mantığıyla, kartta nakite göre zarar etsek de tolere edebilecek seviyelere kadar idare ediyoruz."*
Bu bir kabul, bir kaza değil — ve tartışması yapılmıştır, yeniden açılmaz.

**Kart tahsilatından stüdyoya kalan:**

```
kalan = kart fiyatı − KDV − TAMI komisyonu
KDV (%20, fiyata dahil) = fiyat ÷ 6        → %16,67
komisyon = %2,85 (tek çekim) … %7,95 (3 taksit)
```

**2026-08 fiyatlarıyla, 3 taksit senaryosunda:**

| Paket | Kart | Kalan | Nakit fiyat | **Oran** |
|---|---|---|---|---|
| Pilates 8 Ders | 5.000 | 3.769 | 4.200 | **%90** |
| Fitness 12 Aylık | 22.000 | 16.584 | 19.500 | %85 |
| Fitness 3 Aylık | 9.500 | 7.161 | 8.500 | %84 |
| Pilates 16 Ders | 8.600 | 6.483 | 7.800 | %83 |
| Fitness 6 Aylık | 14.000 | 10.554 | 12.750 | **%83** |

**Eşik: bu oran %80'in altına düşerse fiyat gözden geçirilir.** Şu an hepsi üstünde ve dağılım dar
(%83–90) — yani "şu pakette kart orantısız kötü" diye bir yamukluk yok. **Eşiği ilk kıracak olan
Fitness 6 Aylık**; komisyon oranı artarsa ya da KDV değişirse önce oraya bakılır.

**Komisyon küçük ortak.** Kart fiyatının **%16,67'si KDV**, komisyon %2,85–7,95. Bunun iki sonucu
var ve ikisi de tekrar tartışılmasın diye yazılıyor:

- **Taksit kararı ikinci derecedendir.** Tek çekimle 3 taksit arası fark kart fiyatının %5,1'i —
  Pilates 8'de 255 ₺. "Ödeme kolaylığıyla hacim" stratejisinin en ucuz parçası taksit. 3 taksidi
  komisyon gerekçesiyle tekrar sorgulamaya değmez ([[OR-44]]).
- **Vade farkı çarpanı REDDEDİLDİ.** TAMI'nin tablosundaki çarpanla (3 taksit ×1,0864) tutarı baştan
  şişirmek gündeme geldi. Üç sebeple yapılmadı: **(1)** çok daha büyük bir açığın yalnızca %7,95'ini
  kapatır; **(2)** taksit sayısı önceden bilinemez — TAMI teyit etti, token'da sabitleyen parametre
  yok — yani 3 taksit için şişirilen tutarda müşteri tek çekim seçerse ondan fazla tahsil edilir, ve
  tek çekim en yaygın seçenek; **(3)** ilan edilen fiyatla tahsil edilen fiyat ayrışır, ki mesafeli
  satış metinlerini bu ay yayınladık.

**Fiyat, müşteriye söylendikten günler sonra değişen bir şey değildir.** İnce marjlı paketler bir
sonraki DOĞAL fiyat güncellemesinde (zam, yeni sezon, yeni paket) düzeltilir — ortasında değil.
Güveni aşındıran şey rakamın kendisi değil, oynaklığı.

---

**OR-46 · Demo, Işıl'ın verisiyle aynı veritabanında yaşar — ve oraya ULAŞAMAZ.** (2026-08-26)

Bir aracı sistemi görmek istedi. Owner'ın koyduğu üç şart net: **(1)** Işıl'ın verisiyle karışmayacak,
**(2)** stüdyonun adı "Demo Stüdyo" olacak, **(3)** aracıya ve isteyen herkese erişim verilecek.

Owner'ın kendi cümlesi kuralın gerekçesi: *"bak sakın ışıl a bulaşma orayı bozarsak hiç bir şeyin
önemi yok."*

**Ayrı bir proje açılmadı, kasten.** Ayrı proje demoyu izole ederdi ama demoyu ÜRÜNDEN de izole
ederdi: ikinci bir dağıtım, ikinci bir sürüm, ve birkaç hafta sonra aracıya gösterilen şeyin canlı
üründen farklı olduğu bir durum. Çok kiracılılık zaten bunun için var. Riski taşıyan şey mimari
değil, **elle yazılan bir stüdyo id'si.**

**Bu yüzden demoya yazan hiçbir script'e "dikkatli ol" denmiyor.** `tools/seed/demo-guard.ts`
Firestore'u bir proxy'ye sarıyor; `studios/demo/` dışındaki her yol — **okumalar dahil** — veritabanına
ulaşmadan istisna atıyor. Okumanın da kilitli olması bilinçli: yanlış stüdyodan okuyup demo verisine
karıştırmak, yanlış yere yazmak kadar kötü ve fark edilmesi daha zor.

**Demoya yazan her yeni script bu kilidi kullanmak zorundadır.** Kilitsiz bir `getFirestore()` ile
demo verisi yazmak, kuralı çiğnemektir — çalışsa bile.

Doğrulama, her seferinde, tek yol: script'ten önce ve sonra `retro`'nun sayıları. 2026-08-26'da
171 üye → 171 üye.

