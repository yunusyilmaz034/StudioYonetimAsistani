# 29 — Migration, Cutover & Production Hardening (v1.26)

**Status:** as built · **Date:** 2026-07-13

The milestone that made the product **operable**. It ships almost no capability and it is the most
important one since v1.4.

---

## 1. What this milestone was for

Every milestone since v1.4 added **capability**. None added **operability**. There was no CI, no
environment separation, no monitoring, no backup, no migration path — and, as it turned out, no
Cloud Function had ever run.

> **A product that cannot be cut over is a demo, however good its dashboard is.**

---

## 2. The finding that changed the shape of the milestone

The plan called this a debt-repayment milestone. The first hour of it proved otherwise.

**The entire Cloud Functions layer had never executed.** Not in production — it had never been
deployed — and not even in the emulator. Two independent breaks, either of which alone made a deploy
impossible:

1. `apps/functions` is `"type": "module"` while the shared tsconfig used `moduleResolution: "Bundler"`,
   so the emitted imports had no `.js` extensions and Node's ESM loader refused them.
2. `@studio/core` ships **raw TypeScript** (`"main": "./src/index.ts"`) as a `workspace:*` symlink
   that `firebase deploy` never uploads. And `firebase.json` had **no `predeploy` hook**, so nothing
   was compiled before a deploy at all.

Which means that on 2026-07-12, the following had **never run once**:

| | What depends on it |
|---|---|
| `onCommandCreated` | the offline write path — every check-in and attendance mark reception takes without internet |
| `onEventCreated` | the daily projection (the owner dashboard's numbers) **and** the entire notification pipeline |
| `nightlySweep` | auto-resolution → credit expiry → auto-check-out → reminders |
| `notificationRetry` | every queued and retrying message |

**And `pnpm check` was green the whole time.** The domain and application layers were tested to
death; the *dispatch* layer — the wiring between a Firestore write and a function — was tested by
nothing, and could not have been, because no function could load.

The CHANGELOG's "16/16 emulator checks" were not false, but they were **misleading**: those scripts
import `@studio/core` directly and drive it against the Firestore emulator with the Admin SDK. They
prove the decisions. They never touched a trigger.

**The lesson, written down because it will recur:** a test suite that only exercises the layers you
wrote will never tell you about the layer you *configured*.

### The fix

`apps/functions/build.mjs` — **esbuild bundles the domain INTO the artifact**: one CJS file, no
workspace links, every import resolved at build time. Only `firebase-admin` and `firebase-functions`
stay external, because GCP installs those itself. `@studio/core` moved to `devDependencies` — it is a
*build-time* dependency now, and leaving `workspace:*` in the deployed manifest would break
`npm install` on GCP.

CJS, not ESM: `firebase-admin` and `firebase-functions` ship CommonJS, and ESM→CJS named-import
interop is the most fragile seam in Node. Gen-2 Functions default to CJS. This is the combination
with the fewest ways to fail at 03:00.

**`pnpm build:functions` is now part of `pnpm check`.** The break that made deployment impossible
used to pass the gate. It now fails it.

### The second defect it surfaced

**Every function was bound to `us-central1`.** No region was declared, so they fell to the SDK
default — while Firestore lives in `eur3`. Every trigger would have crossed the Atlantic to reach its
own database: a latency cost, and an EU-residency posture we would rather not have had to argue.

A region is part of a deployed function's identity — changing it later creates a *second* function
rather than moving the first. **It was free to fix because nothing had been deployed. A week later it
would not have been.**

It is declared on **each** function (`shared/region.ts`), not only via `setGlobalOptions`: a trigger
is defined when its module is *evaluated*, and ES imports are hoisted above the body of `index.ts`.
A global set in that body arrives too late. **Correctness must not depend on import order.**

---

## 3. The poison message (DEBT-025)

The first integration test ever written against `onCommandCreated` killed it.

The repositories raise a plain `Error` when a referenced document is missing
(`"Reservation not found: …"`). On the synchronous path that is survivable — the user sees a failure.
On the offline path it is fatal: **an unhandled throw kills the function; Firestore redelivers
at-least-once; it throws again.** The command sits in `pending` **forever** and the write it carried
— a check-in, an attendance mark — vanishes in silence, while reception's optimistic UI has already
told her the member walked in.

**A bad QR scan is enough to reach it.** So is a malformed document, and `/commands` is the *only
client-writable collection* in the system.

The handler now cannot die: a malformed document is refused, a throw is resolved as `failed` with a
reason, and **even writing the outcome** is guarded (the document may be gone, and `update()` on a
missing document throws — a handler that dies while recording a failure is the same poison message
wearing a hat).

The trade-off is stated, not hidden (DEBT-025): a genuinely transient infrastructure error now lands
as `failed` instead of being retried. We accept it because the admin SDK already retries transient
gRPC failures internally — an exception that escapes to us has almost certainly exhausted its own
retries. **And a visible `failed` beats an invisible infinite retry: a poison message that never
resolves is the worse failure, because nobody can even see it.**

---

## 4. The migration — smaller than the architecture expected, and honest about it

BulutGym exports **a name and a phone**. That is all (owner, 2026-07-13). ~45 active members.

So that is all that is imported. **Packages, credits, balances and history are not derived, not
estimated and not carried over** — they are opened by hand, member by member, against the owner's own
list. Forty-five members is an afternoon. A guessed credit balance is a dispute that lasts a year.

### The consequence, said out loud

**AD-11 cannot be executed for this customer.** The architecture promised that the importer would
emit historical events, so the log would contain the studio's real history rather than a cliff at
go-live — *"the single most valuable asset for future ML"*. There is no such data to import.

**This studio's event log begins at go-live.** The raw export is archived to Cloud Storage anyway:
the day BulutGym's subscription lapses, whatever it held becomes unrecoverable forever.

This is not an architectural failure. It is the source data's natural limit, and the right response
to it is to say so rather than to synthesise a history that never happened.

### The pipeline (AD-36 — a script folder, never a package, never in CI)

```
CSV ──▶ [adapter]     BulutGym-specific: the ONE file customer #2 changes
           ▼
      canonical DTOs
           ▼
      [validator]     fail loudly, NEVER guess
           │            · phone → E.164, or the row is REFUSED (AD-40)
           │            · a collision is REPORTED with its line number, never MERGED (I-21)
           │            · ONE bad row blocks the ENTIRE run
           ▼
      [importer]      registerMember, actor: {type:'migration'}, source: 'migration'
           ▼
      [reconciler]    the report a HUMAN signs
```

**Why CSV and not `.xlsx`.** This script runs once, by hand, with admin credentials, against
production. It is the most dangerous code in the repository, and the right thing to give it is the
*smallest possible surface*: no spreadsheet parser, no dependency, no macro engine. Excel exports CSV
in one click — and a CSV is human-readable, which is what lets the error report say **"line 34"** to
somebody who can then open the file and look at line 34.

**All-or-nothing.** A partial import leaves a members list that is *almost* right, and nobody can
tell which half. The cost of refusing is an afternoon with a spreadsheet. The cost of a half-import
is discovering in March that a member has been missing since January.

**Idempotent by construction.** Re-running the import writes nothing: the phone is unique (I-21) and
the domain refuses the same member twice. That is not a feature bolted on; it is the invariant doing
its job.

---

## 5. The legacy money migration (DEBT-021), and AD-66

The v1.14 money fields on the entitlement (`priceAgreed`, `manualPayment`) became real `Sale` +
`Payment` + `Allocation` rows in the v1.24 ledger. Owner decision (a): **migrate once, with
reconciliation**, rather than carry `if (legacy)` through every query and report forever.

**It calls the real `sell()` use-case, not hand-written events.** The ledger's arithmetic —
allocation, balance, over-payment, I-32…I-35 — lives in the domain. A migration that bypasses it to
save an afternoon produces a ledger that is subtly, permanently, **unverifiably** wrong.

The `Clock` is **injected, pinned to the original purchase instant**, so `soldAt` is the day the
package was bought and not the day we migrated it. Otherwise every historical sale lands on one day
and every revenue chart lies.

The sale id is **derived from the entitlement id**, so a second run writes nothing. *A migration that
double-charges every member on its second run is a migration that will, once, be run twice.*

### `drawer_required` — the collision, and why it was the rule WORKING

Six of seven packages were refused. A cash payment must land in an open kasa (v1.24) — but **there
was no kasa before v1.24**, and the historical payments were cash. The domain refused to pretend a
control had been exercised when it had not.

There were four ways out and three of them put a lie somewhere:

| | The lie it tells |
|---|---|
| A synthetic "migration drawer" | Fabricates a gün sonu that never happened — **inside the one control the owner relies on to catch theft.** |
| Re-label the payments `bank_transfer` | Falsifies how the member actually paid. |
| Skip the payments, migrate only sales | Every migrated member appears to owe what she already paid. |
| **Exempt the `migration` actor** *(AD-66, owner)* | **None.** Method stays `cash` (true), drawer stays `null` (true), and what we do not know stays empty. |

**The kasa is a control over the act of taking cash at the desk. A migration takes no cash.** It
records cash taken years ago, in a system that had no drawer to control. This is not an exception to
a finance rule; it is a rule about *who the actor is* — and `migration` is a first-class principal
precisely so the domain can say this out loud (#5).

It is unreachable by a human, a client or an AI: the actor is derived server-side and exists only
inside `tools/migration`, run by hand. **Tested from both sides** — a migration may record a
drawerless cash payment, and **a human still may not.** The second test is the one that matters: an
exemption that quietly widened would remove the studio's only defence against cash walking out of
the building.

**Result:** 7 sales (30.300,00 ₺), 6 payments (21.200,00 ₺), zero failures. Reconciliation fails with
7 mismatches *before* the run and is **clean to the kuruş** after it.

The entitlement's money fields are **not dropped**. Expand → migrate → **contract**, and the contract
is a separate, later decision (Doc 6 §10). *Data a migration both writes and deletes on the same day
is data nobody can verify.*

---

## 6. Observability — five signals, because each fails SILENTLY

Nothing crashes. Nobody is told. The product carries on looking exactly as correct as it did
yesterday.

| `alert` | When | Why it is silent |
|---|---|---|
| `commands_stuck` | a command `pending` > 5 min | The trigger died; check-ins vanish. **Reception sees nothing** — the UI is optimistic and already said "girdi". |
| `projection_lag` | watermark > 1 h behind the log | The dashboard is stale and renders it **with total confidence**. There is no "these numbers are old" state. |
| `booked_count_drift` | nightly | A class silently over- or under-sells. |
| `credit_ledger_drift` | nightly | A write path bypassed the transaction (DEBT-004). |
| `expiring_with_held` | nightly | The expiry sweep would burn a credit a class is about to consume (I-19). |

> **The drift check REPORTS. It never REPAIRS.** A self-healing system hides its bugs, and the bug is
> the thing you need to know about. Correcting `credits.available` would destroy the only evidence
> that a write path bypassed a transaction. **A test asserts that the number is *not* repaired.**

Each alarm is an `ERROR` log line with a stable `alert` field — the contract a Cloud Logging
log-based alert matches on, and **every value has a runbook entry**. *An alert with no runbook entry
is a pager that teaches nobody anything.*

Each is proven by an integration test that **plants the exact corruption** and asserts the check saw
it. *An untested alarm is not an alarm; it is a file that makes everyone feel safer.*

**Structured logging in `apps/web`**, which previously logged **nothing** — the path the money
travels was the least observable in the system. No library: App Hosting runs on Cloud Run, where a
JSON object on stdout **is** a structured log entry. What was needed was not a package but a
discipline, and a discipline needs exactly one door (`server/log.ts`).

The `observed()` wrapper keeps three outcomes apart, because an alarm must never confuse them:

- **success** → an event was appended; the line joins that permanent record to the request
- **refusal** → the domain worked and said no. It writes **no event** — so if it is not logged, it
  did not happen, and *"why couldn't reception book her in?"* has no answer anywhere
- **throw** → the product failed. **The only one of the three worth waking somebody for.**

---

## 7. KVKK — the day the most expensive rule paid for itself

`pnpm kvkk:erase` empties every place a name can live: the member record (**tombstoned, not
deleted** — deleting it would break every join and turn a lawful erasure into a corrupt database),
the denormalised `memberSnapshot` on her reservations (DEBT-003 said this day would come), her
notification intents, her inbox, her invites, her Auth login.

**It does not touch `/events`, and it does not need to.**

PII has never entered an event payload (#6). That rule cost us convenience for two years, and this is
what it bought: her bookings, her credits, her payments and her check-ins stay in the log — the
ledger still balances, the revenue reports still add up, the AI still has its substrate — and **none
of it says who she was.**

> **A system that had put her name in its events would face a choice here between obeying the law and
> keeping its own books. We do not have that choice to make, and it is not luck.**

`member.erased` (AD-67) records the *fact* of the erasure, permanently and anonymously: an opaque id,
a **closed-enum** reason, a timestamp. Free text is the last place PII can hide in a permanent log
(*"Ayşe Yılmaz'ın avukatı aradı"*) — the human's explanation lives on the tombstone in **state**,
where it can itself be erased. `platform_admin` only; idempotent; and the audit screen says
**"anonimleştirildi"**, not "silindi", because that is the honest word.

---

## 8. What is proven, and what is only prepared

| Proven, against the emulator | Prepared, needs a real project |
|---|---|
| All 5 functions load and fire, in `europe-west1` | Deploy to staging / prod |
| Projector idempotency (3 deliveries → 1 count) | Composite index deploy *(a missing index passes in the emulator and **fails in production**)* |
| Portal end to end (invite → activate → book → cancel) | The alarm channel (signals exist; the bell does not) |
| All five health signals fire on planted corruption | **Backup + restore rehearsal** |
| Migration: dirty rejected, dry-run, apply, re-apply | Resend API key + DNS (SPF/DKIM) |
| Legacy finance: reconciled to the kuruş | Meta WhatsApp credentials |
| KVKK erasure: PII gone, log untouched, idempotent | |

**Every item in the right-hand column is on the go/no-go checklist** (`docs/CUTOVER.md`), and none of
them can be closed without the owner. That is not a gap in the work; it is where the work correctly
stops.

---

## 9. Decisions

| # | Decision |
|---|---|
| **AD-66** | The kasa requirement does not apply to the `migration` actor. §5. |
| **AD-67** | KVKK erasure is `member.erased` with a closed-enum reason; the member is tombstoned, never deleted; `/events` is untouched. §7. |

## 10. Debt

**Repaid:** DEBT-011 (Functions deploy) · DEBT-012 (redirect loop) · DEBT-013 (QR secret) ·
DEBT-014 (portal e2e) · DEBT-015 (shell boundary) · DEBT-021 (two money models) · DEBT-023 (e-mail
transport).

**Taken:** DEBT-025 — the command handler treats every exception as permanent. §3.

**Left standing, on purpose:** DEBT-016/017/019/020/022/024 (each has a trigger, none has arrived) ·
DEBT-009/010 (money arithmetic the owner has not decided) · DEBT-018 (auto-promotion is a *feature*,
and v1.26 ships none).
