# Release Notes

---

## v1.29.1-rc1 — hotfixes B-1 and B-2 · **production could not have started without these**

**2026-07-13** · `main` re-frozen. Bugfix only.

Two things stood between RC1 and a pilot, and both were found by reading the deploy configuration
rather than by running the product — which is exactly where they would have been found otherwise: on
the first morning, by the owner.

**B-1 — nobody could have signed in.** The Firebase web config was **hardcoded to the emulator's demo
values** (`apiKey: 'demo-api-key'`, `authDomain: 'demo-sos.firebaseapp.com'`); only the project id came
from the environment. Against a real project that key is not a key. The login screen would have refused
everyone. Now `NEXT_PUBLIC_FIREBASE_API_KEY` and `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`, named in
`apphosting.yaml`. They are **identifiers, not credentials** — what protects the data is Auth plus the
security rules, and that is why they may sit in the browser bundle at all.

**B-2 — the studio could have taken no cash at all.** `openDrawer` refuses a till that does not exist,
and **nothing in the repository created one** — not a screen, not a script. On a fresh project the Kasa
screen would have been empty, with nothing to open, and every cash sale refused with `drawer_required`
— correctly, and for ever. The till is now created in **Ayarlar** (owner's call: a studio may want a
second one, a POS drawer beside the cash one, and that is a setup decision rather than an accident of
birth). It is born **closed**: a till that appears already open, with money in it, is a till whose
opening balance nobody counted — and the whole day-end count is judged against that number.

`drawer.created` is a **new** event type, because creating a till is a state change and every state
change writes one (#1). Nothing existing was touched: no version bump, no upcaster, and the golden
fixtures prove it.

The three harnesses now create the till through the **product's own path** rather than hand-writing it
into Firestore. A harness that hand-crafts the state it tests proves nothing about the state the studio
will actually have — which is how B-2 hid for this long.

---

## v1.29-rc1 — **Product Alpha V1 · the reference release**

**2026-07-13** · `main` is **hotfix-only** from this commit. Product Plus work starts on
`feature/product-plus`. No new features.

> **What this release is:** a studio running on BulutGym today can move to this system without losing
> a single daily operation — and the owner can, for the first time, open one screen and know what
> needs attention.

### The gate

| | |
|---|---|
| `pnpm check` | 517 unit tests · 0 dependency violations · typecheck incl. `tools/` · lint · depcruise |
| `pnpm test:golden` | 64 event-payload fixtures — **no event schema changed in Alpha** |
| `pnpm test:integration` | 35, against the emulator (rules · triggers · health · portal e2e · **cash-drawer concurrency**) |
| `next build` | compiled |
| `pnpm verify:alpha` | a studio's whole day, end to end |
| `pnpm stress` | capacity, counters and the till hold under contention |
| `pnpm monkey` | random operations, not one invariant broken |

### What a studio can do

**Reception's day** — members (with the filters she actually needs at 09:00: pasif · donmuş · bitecek ·
kredisi azalan · paketsiz · borçlu) · packages, sales, collections, freeze, receipts · reservations,
recurring booking, bulk cancel / move / trainer-change · QR check-in on the iPad, and offline when the
wifi dies · the waiting list · the kasa and the day-end count.

**The owner's questions** — the dashboard (one read), the activity feed in human sentences, the seven
reports, the audit trail, the five system alerts on a screen, the analytics.

**The obligations** — KVKK erasure that does not touch the event log · the BulutGym import that
refuses a file it cannot read rather than guessing · the notification centre.

**The trainer** — one screen: her classes, her week, her registers, and the names of the women in
front of her. Not a phone number, not a package, not a balance.

### The three bugs this release exists to have found

**1. The money went where nobody was looking.** Reception's only sell path wrote the payment onto the
*entitlement*. The dashboard, the sales report, the collections report, the kasa and the cari hesap
all read the *ledger*. A package sold for 3.000 ₺ in cash produced a dashboard of 0 ₺, empty reports
and an empty till. Two money models had been running at once, and the product wrote to the wrong one.
The ledger is now the single truth (`sellPackage`).

**2. The till lost money under contention.** Twelve concurrent cash payments of 3.000 ₺ left 3.000 ₺
in the drawer. Eleven vanished — the drawer was read *outside* the transaction and the whole document
written back, and Firestore only serialises on documents read *inside* one. Every receipt was correct.
The day-end simply came up 33.000 ₺ short, with nothing to explain it. **That is the shape of bug a
studio never recovers from, because it does not look like an error — it looks like theft.** The till
is now a counter re-read inside the transaction.

**3. `<Toaster />` was never mounted.** On four screens — settings, staff, the import, and the
trainer's *only* screen — every error the code fired rendered nothing at all. A save that was refused
looked exactly like a save that worked.

None of the three could have been caught by a unit test. The deciders were right in all three cases.

### Enforced, at last

**AG-1 — working hours.** Stored since S2 and enforced nowhere: the form warned, the engine shrugged,
and a class could be scheduled *and booked* at three in the morning. Now two gates (a class cannot be
created, a seat cannot be taken), and the calendar's `special_working_day` overrides the weekly hours
— because the more specific statement wins. Wiring the guard as a **required** dependency caught the
member portal and the waitlist promotion, both of which book, and neither of which anybody had thought
about.

### Known, and deliberate

- **DEBT-027** — a package sale spans two transactions. Every decider runs first, so a refusal costs
  nothing; then the *grant* goes first, because the surviving race leaves her with a package and a
  **visible** debt. The other order leaves her having paid for nothing, silently.
- **DEBT-028** — `giftCard.redeemed` has the lost-update shape the till had. **Unreachable:** no screen
  can issue a gift card. Repay trigger: the day one can.
- **Out of Alpha, on purpose:** bulk reservation *creation* (many members into one class) · gift cards ·
  coupons · payment plans · the CRM offer lifecycle. Each is domain that exists and is tested, with no
  screen — and the checklist says so rather than pretending otherwise.

### Waiting on the outside world, not on us

`docs/EXTERNAL-DEPENDENCIES.md` — **ED-1** WhatsApp (Meta account + approved templates; the provider is
written and mock-tested, the transport is a credential) · **ED-2** e-mail (Resend key + SPF/DKIM — set
the DNS *before* the key, or the mail sends and lands in spam, which is worse than not sending) ·
**ED-3** the production Firebase project and its secrets.

### Next

Pilot install and real-user validation. See `docs/CUTOVER.md` — **§1.5 first**: on a new project there
is no owner, no ders türü, no salon and no working hours, and reception cannot schedule a class until
there are.

---

## Earlier

| Tag | What it added |
|---|---|
| `v1.28-alpha-freeze` | Alpha Review (11 defects) · the money model unified · Alpha frozen |
| `v1.27-product-alpha` | S1–S7: staff & roles · studio settings · sales & freeze · reception & kiosk · KVKK & import · the seven reports · bulk ops, list filters, system alerts |
| `v1.26-production-hardening` | Functions actually deployable · region pinned · migration & reconciliation · health signals · runbook · KVKK erasure |
| `v1.25-notification-center` | Event → Intent → Delivery Attempt · in-app + e-mail live · quiet hours · intent collapse |
| `v1.24-finance-crm` | The money ledger (Sale · Payment · Allocation · Refund) · kasa & day-end · CRM funnel |
| `v1.23-owner-dashboard` | The first projection · the widget contract · analytics · the export contract |
| `v1.22-operations-engine` | Studio calendar · closures · bulk package ops · reservation move · waiting list · operations centre |
