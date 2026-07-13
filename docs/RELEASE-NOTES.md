# Release Notes

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
