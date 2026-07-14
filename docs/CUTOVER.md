# Cutover

The plan for the day the studio stops using BulutGym and starts using this.

It is short on purpose. A cutover plan nobody can hold in their head at 07:00 on a Monday is a
cutover plan that gets improvised.

---

## 1. The shape of the day (AD-12 — freeze and cut)

**Parallel writable operation is rejected.** Two systems that can both check a member in produce two
credit balances and no principled way to reconcile them — only a guess about which one was right.
The old system goes read-only at a declared instant, and it never takes another write.

```
T-7g   Staging rehearsal, end to end. At least one CLEAN run.
T-1g   Rollback rehearsed, and TIMED. The old system must come back in under ten minutes.
T-0    BulutGym → READ-ONLY. Declared instant, announced to staff. Nobody writes to it again.
T+1h   Final export. Archived raw to Cloud Storage, unparsed.
T+2h   Import to production:  pnpm migrate:validate → migrate:dry-run → migrate:import --apply
T+3h   Packages opened BY HAND, member by member, against the owner's own list.
T+4h   pnpm migrate:reconcile → the owner reads the credit table and SIGNS it.
T+4h   pnpm projections:rebuild && projections:verify   ← MANDATORY, and AFTER the migration.
T+5h   New system is the only writer.
—      BulutGym stays READABLE for four weeks as a dispute reference, then is archived.
```

**Why the packages are opened by hand.** BulutGym exports a name and a phone; nothing else (owner,
2026-07-13). Credits, balances and history are therefore **not imported, not derived, and not
estimated** — they are entered by a human who is looking at the old system. Forty-five members is an
afternoon. A guessed credit balance is a dispute that lasts a year.

---

## 1.4 There is no staging, so production rehearses on itself — and is then WIPED

**Owner, 2026-07-14:** Blaze on the staging project needs a 1.500 ₺ prepayment, so staging stays on
Spark. **Spark runs no Cloud Functions and no Secret Manager** — which means the check-in trigger, the
nightly sweeps, the health signals, the notification retry and the QR secret cannot be rehearsed there
at all.

**We do not do an unrehearsed cutover.** So the order changes:

1. **The production project is its own rehearsal ground.** Before a single real member exists, run the
   whole mock day there: every function observed firing, every alarm deliberately tripped, the
   migration dry-run, a full reception day, the rollback timed.
2. **Then the data is destroyed, and the destruction is verified.** The real cutover starts from an
   empty database.

**This is the part that is not negotiable.** An event is never mutated and never deleted (#1) — so if
rehearsal events survive into the real log, they are in the studio's history *for ever*, and nothing
later can tell them apart from the real thing. Before the real cutover:

- [ ] `/studios/{sid}/events` returns **zero documents** — checked, not assumed
- [ ] Every collection under `/studios/{sid}` is empty
- [ ] The Auth user list holds only the accounts the studio will actually use
- [ ] `projections:rebuild` produces an **empty** daily read model

Upgrade staging to Blaze whenever the prepayment is convenient; the moment it exists, the rehearsal
moves there and production stops being touched by anything that is not real.

---

## 1.45 Do not delete `"dependencies": {}` from the root `package.json`

It is empty. It looks like dead weight. **It is load-bearing, and deleting it kills the production
deploy silently.**

App Hosting's Node.js buildpack, when `apphosting.yaml` contains `scripts.buildCommand`, **rewrites the
repo's root `package.json`** immediately before `pnpm install` — from its own Go struct
(`pkg/nodejs/nodejs.go` → `OverrideAppHostingBuildScript`). That struct declares:

```go
Dependencies map[string]string `json:"dependencies"`   // ← no omitempty
```

If the field is absent from our file, Go's nil map is written to disk as **`"dependencies": null`** —
and pnpm 9 and 10 read that manifest, call `Object.keys(null)`, and die with:

```
ERROR  Cannot convert undefined or null to object
```

…in under 300 ms, before a single network fetch. It **never happens locally**, because locally nothing
rewrites `package.json`. That is why the build was green on every machine and red in every rollout.

An empty object is enough: Go unmarshals it into a **non-nil** empty map and writes it back as `{}`.

*(This is a real bug in Google's buildpack — a missing `omitempty`. Firebase closed the matching report
([firebase-tools#10435](https://github.com/firebase/firebase-tools/issues/10435)) as "not planned",
because nobody had found the mechanism. We are not waiting for a fix we do not need.)*

**Do not "clean up" that line.**

---

## 1.5 Setup — the studio does not exist until these are done

**Added at RC1, because the checklist below assumed a studio that was already there.** On a brand-new
production project there is no owner, no ders türü, no salon, no working hours and no catalogue — and
without them reception cannot schedule a single class. In that order:

| # | Do this | Why it is first |
|---|---|---|
| 1 | `pnpm bootstrap:owner` | **The only way a first user exists.** There is no setup wizard, deliberately: a public "create the first owner" endpoint is a public "create an owner" endpoint on the day somebody forgets to remove it. Order inside the script matters — Auth user, then `/staff` doc + `staff.created` in one transaction, then the claims **last**. |
| 2 | Ayarlar → **Ders türleri** | A class needs a service. Its **category is immutable** (I-22): it is what the category wall is judged against, and changing it later would retroactively change which packages open which classes. |
| 3 | Ayarlar → **Salonlar** | A class's capacity may not exceed its room's. |
| 4 | Ayarlar → **Çalışma saatleri** | **They are enforced** (AG-1): a class cannot be created — or booked — outside them. A studio that leaves them empty is not policed, which is a choice, not an accident. |
| 5 | Ayarlar → şirket bilgileri | Every receipt and every e-mail reads them from this one document. |
| 6 | Paketler → the catalogue | Products are **data** (AD-41). Nothing in the source tree knows a price. |
| 7 | Ayarlar → **Kasalar** → create "Merkez Kasa" | **Do this or the studio can take no cash at all.** A studio starts with no till, and a cash sale into no till is refused (`drawer_required`) — correctly, and for ever. It is created here once; a second one (a POS drawer) can be added later. |
| 7b | Kasa → **open the till** | It is created CLOSED. Reception opens it every morning and counts what is in it — that opening float is the number the day-end is judged against. |
| 8 | Personel → reception, trainers | The last active owner can never be deactivated or demoted. |

---

## 2. Go / no-go

**Every box, or the cutover is postponed.** No exceptions, no "we'll fix it Tuesday". The point of a
checklist is that it is allowed to say no to you.

### The machine
- [ ] **All seven gates green on the RC1 commit:**
      `pnpm check` (typecheck incl. `tools/` · lint · depcruise · 517 unit) ·
      `pnpm test:golden` (64) · `pnpm test:integration` (35) · `next build` ·
      `pnpm verify:alpha` · `pnpm stress` · `pnpm monkey`
- [ ] CI green on `main`
- [ ] Functions deployed to prod: `onCommandCreated` · `onEventCreated` · `nightlySweep` · `notificationRetry` · `healthCheck`
- [ ] **Every one of them observed firing at least once on staging** — a deployed function nobody saw run is a function nobody knows works
- [ ] Firestore **rules AND indexes** deployed *(a missing composite index passes in the emulator and fails in production)*
- [ ] Region confirmed: Firestore `eur3`, Functions `europe-west1`

### The data
- [ ] Raw BulutGym export archived to Cloud Storage, **unparsed**
- [ ] **Zero rejected rows** in `validation.md` — every collision resolved by a human, never by the importer
- [ ] `migrate:reconcile` clean: zero credit-ledger drift, zero finance mismatch
- [ ] **The owner has read the remaining-credits table and signed it**
- [ ] Twenty members spot-checked by hand against BulutGym
- [ ] `grep` the source tree for a product name and find nothing *(AD-41 — the catalogue is data)*

### The eyes
- [ ] Five signals live; each deliberately tripped once and the alarm seen to arrive
- [ ] Daily backup running **and a restore rehearsed** — *a backup whose restore has never been tried is a bill, not a backup*
- [ ] `projections:rebuild` + `projections:verify` run once against production-like data: **zero diff**
- [ ] **The projection was rebuilt AFTER the legacy money migration, not before.** The migration
      generates a `sale.created` for every legacy purchase; a projection folded before the v1.26
      change counted both families and reported **exactly double the revenue** (Doc 29). The rebuild
      is what makes the dashboard agree with the ledger.

### The perimeter
- [ ] **`NEXT_PUBLIC_FIREBASE_API_KEY` and `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` set to the real project's**
      *(they used to be hardcoded to the emulator's demo values — with those, **nobody can sign in**, and
      the owner would have met it on the first morning of the pilot. They are IDENTIFIERS, not secrets:
      what protects the data is Auth plus the security rules.)*
- [ ] **Somebody has actually signed in to the deployed app.** Not "the deploy succeeded" — signed in.
- [ ] `QR_TOKEN_SECRET` provisioned in Secret Manager (not a dev value — `secrets.ts` refuses to start without it)
- [ ] `RESEND_API_KEY` + `EMAIL_FROM` provisioned, **and a real e-mail has arrived in a real inbox**
- [ ] Security rules tests pass **against the rules that are actually deployed**
- [ ] Session cookie is `Secure` (it is, when `NODE_ENV=production`)

### The behaviour
- [ ] Reception has run a full mock day on staging
- [ ] Offline check-in verified **with the wifi physically off**
- [ ] A full-class booking is refused, and the refusal is legible in Turkish
- [ ] An exactly-six-hour cancellation returns the credit
- [ ] The attendance auto-resolver has run once on staging: every unresolved reservation became `reservation.auto_resolved` with `source: 'system_default'`, and **not one `reservation.attended` was written by the `system` actor** *(I-18)*
- [ ] The expiry sweep ran **after** it, and refused to touch any entitlement still holding a credit *(I-19)*

### The way back
- [ ] Rollback rehearsed **and timed**: BulutGym can be un-frozen in under ten minutes

---

## 3. Smoke test — the first thirty minutes on production

Run in this order, as the real roles, on a real phone. Each one is a path a member's money or a
member's morning depends on.

| # | Do this | It must |
|---|---|---|
| 1 | Sign in as the owner | land on the dashboard, no redirect loop *(DEBT-012)* |
| 2 | Sign in as reception on a phone | render at 375 px with no horizontal scroll |
| 3 | Create a member with a Turkish phone (`0532…`) | store `+90532…` — E.164 or refuse |
| 4 | Create the same phone again | be **refused** *(I-21)* |
| 5 | Sell a package, collect cash into an open kasa | appear in the Activity feed as **one** Turkish sentence, one OperationId |
| 5b | **Open the dashboard, the Satış raporu, the Tahsilat raporu and the Kasa** | **all four show that money.** This is the bug the Alpha review found: the sale used to be written where nobody looks, and the dashboard read 0 ₺ while the drawer was empty. If any of the four is blank, **stop the cutover** |
| 5c | Print the receipt | the paid amount matches the till, and it says **"BU BELGE MALİ BELGE DEĞİLDİR."** |
| 5d | Try a cash sale with the **kasa closed** | be **refused**. Money taken at the desk with no till open is money the day-end can never explain |
| 6 | Close the kasa with a deliberate 10 ₺ discrepancy and no note | be **refused** — the domain does not let a drawer balance itself |
| 7 | Book the member into a class | drop `available` by one, `held` = 1, `consumed` = 0 |
| 8 | Cancel it inside the window | return the credit; `consumed` never moves |
| 8b | Try to create a class **outside the working hours** (or on a closed day) | be **refused**, in Turkish, naming the hours it refused against *(AG-1)* |
| 8c | Mark that date a **"özel çalışma günü"** in the calendar and try again | **succeed** — the calendar is the more specific statement, and it wins |
| 9 | Check her in by QR | succeed once, and be **refused** on a second scan of the same token |
| 10 | Mark attendance with the wifi OFF | write a `/commands` doc; **and resolve within seconds when the wifi returns** |
| 11 | Cancel a class with members in it | send each of them exactly **one** message, not one per reservation *(intent collapse)* |
| 12 | Check the member's e-mail | a real e-mail, from `noreply@pilatesfitnessbyisil.com`, in a real inbox |
| 13 | Open the member portal as the member | show HER data, and **no owner navigation anywhere** *(DEBT-015)* |
| 14 | Open the owner dashboard | 1 projection read; numbers agree with what you just did |

**Any failure stops the cutover.** The list is short enough to run twice.

---

## 4. Rollback

**The window is one business day, and this is an honesty decision, not an architectural one.**

**Within cutover day:** un-freeze BulutGym, re-enter the day's few dozen transactions by hand, retry
the cutover next week. The precondition is that we have *rehearsed* the un-freeze and know it takes
minutes.

**After one full day of real writes, there is no rollback.** The new system holds facts the old one
does not — a check-in, a payment, a cancelled class. Say this **out loud on Monday morning**, so that
carrying on is a decision somebody made rather than a thing that merely happened.

**Application rollback is a different thing and is always available:** App Hosting keeps releases,
Functions keep versions. **Data rollback is not, and that is deliberate.** The event log is
append-only. A restore from backup does not *undo* the events written since — it loses them. A
mistake is corrected by a **compensating event** with a reason (#9), never by an overwrite and never
by a restore.

---

## 5. The first two weeks (Phase 1.5)

Resist shipping features. The system is one week old and holds people's money.

- Watch `/commands` lag, the drift reports, stuck triggers. The runbook has an entry for each.
- **Watch the attendance correction rate.** If it is *exactly zero* after two weeks, nobody is
  correcting anything and the presumption has quietly become a fiction (DEBT-007). If it is 30%,
  the default is wrong for this studio — and `policy.attendance.defaultOutcome` is a one-document
  change, no code at all.
- Fix what reception actually complains about, which will not be what we predicted.
- Write a DEBT entry for every shortcut taken during the week, **with a trigger to repay each one**.

---

## 6. KVKK — erasure and retention

**Erasure.** `pnpm kvkk:erase -- --studio=<sid> --member=<mid> --reason="…"` (dry-run by default).

It empties every place a name can live: the member record (tombstoned, not deleted — deleting it
would break every join and turn a lawful erasure into a corrupt database), the denormalised
`memberSnapshot` on her reservations (DEBT-003 said this day would come), her notification intents,
her in-app inbox, her invites, and her Auth login.

**It does not touch `/events`, and it does not need to.** PII has never entered an event payload
(#6) — that rule cost us convenience for two years, and this is what it bought: her bookings, her
credits, her payments and her check-ins stay in the log, the ledger still balances, the revenue
reports still add up, and none of it says who she was. **A system that had put her name in its events
would face a choice here between obeying the law and keeping its own books. We do not have that
choice to make, and it is not luck.**

**Retention.**

| Data | Kept | Why |
|---|---|---|
| `/events` | **indefinitely** | Anonymous by construction. There is nothing to erase, and it is the substrate every projection, report and future model is built on. |
| Financial records (sales, payments, the credit ledger) | **10 years** | Turkish Commercial Code. They reference her by an opaque id that now resolves to nobody. |
| `/members`, `memberSnapshot`, notification intents, inbox | **until erasure is requested** | This is where identity lives, and therefore where erasure acts. |
| Raw BulutGym export (Cloud Storage) | **4 weeks after cutover**, then deleted | It is the dispute reference. After that it is a PII liability with no purpose. |
| Migration reports (`tools/migration/reports/`) | **local only, never committed** | They quote members' names and phone numbers. That is what makes them useful, and exactly why they are gitignored. |

Every erasure is written into the studio's KVKK register by hand: date, member id, reason, who asked.

---

## 7. Security review — v1.26

| Area | Finding |
|---|---|
| **Tenant perimeter** | Reads require a **staff** role; a member principal matches no read rule at all. 20 rules tests, including every member-isolation scenario. |
| **The member's own data** | Her `memberId` comes only from the verified session cookie. **No Server Action takes a `memberId`**, so none can be handed a forged one. |
| **`/commands`** | The only client-writable collection. Whitelist enforced twice (rules + dispatch). A malformed document is now **refused, not fatal** — it used to poison the trigger forever (DEBT-025). |
| **`/events`** | Owner-only in the rules. Every screen over it is fed by a Server Action with the role filter **on the server**. Reception never reads a raw event. |
| **QR** | 60-second, server-signed, single-use, verified online. The static-memberId card is gone: it was a bearer credential with no expiry. Signing key in Secret Manager, rotatable with **zero failed scans**. |
| **Secrets** | One door (`server/secrets.ts`). A deployed environment **refuses to start** without them rather than falling back to a value published in this repository — staging included, because staging holds a copy of real members. |
| **Logs** | Structured, with `correlationId` / `studioId` / `actor.type`, and **never PII** — the same rule as event payloads, for the same reason: logs are exported and read by people who have no business knowing a member's phone number. |
| **Money** | Every movement is an event with an actor and a reason. A discretionary one (discount, void, refund, adjustment) also lands in the owner-only audit log. The kasa cannot balance itself. |
| **Open** | Staff accounts and granular authorization are **v1.31**. Today the roles are owner / receptionist / trainer, and staff are provisioned by hand. |
