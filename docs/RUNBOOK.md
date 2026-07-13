# Runbook

What to do when the system says something is wrong — and, just as important, what **never** to do.

This is written for the person on call at 21:00 on a Tuesday, which is one developer and one owner.
There is no rotation, no tiering, no incident commander. At this scale that would be theatre. What
there is: **one alarm channel, one runbook entry per alarm, and one rule about production data.**

---

## The rule that outranks every other line in this file

> **Never edit production data by hand.** Not through the Firebase console, not through a REPL, not
> "just this once, to unblock reception."

A credit that changes without an event is a credit nobody can explain — and the member who disputes
it will be right, and unanswerable. When production data must change, it changes through a
**break-glass script** that runs the same command handlers, with `actor: {type:'platform_admin'}`
and a mandatory `reason`. The event log then contains the intervention, which is exactly what an
audit is for.

**The Firebase console is read-only.** Treat write access there as an incident waiting for an author.

---

## The alarms

Every alarm is a log line at severity `ERROR` carrying a stable `alert` field. Cloud Logging
log-based alerts match on that field. **If an alarm fires and it is not in this table, that is a
defect in this file, not an unknown.**

**The same five checks are also on a screen** (v1.27 S7): the owner sees them live at the top of
`/operations`, in her own language, each one saying what to do. The checks themselves live in
`@studio/core` (`operations/infrastructure/health.ts`) and the scheduled function and the screen run
**the same code** — two implementations of *"is this studio healthy?"* are two answers, and the day
they drift is the day the screen says all-clear about a studio the alarm is already shouting about.

The screen **reports and never repairs**, exactly as the job does. There is no fix button and there
will not be one: a drift is not a number to be corrected, it is the evidence that a write path
bypassed a transaction.

### `commands_stuck` — a command has been `pending` for over five minutes

| | |
|---|---|
| **What it means** | The `onCommandCreated` trigger is not processing the offline write path. |
| **What it costs while it stands** | **Check-ins and attendance marks are vanishing.** Reception sees nothing: the UI is optimistic, so her screen said "girdi" and the write never landed. This is the most dangerous silence the system can produce. |
| **First look** | Cloud Logging → is `onCommandCreated` executing at all? Is it throwing? Was there a deploy in the last hour? |
| **Likely causes** | The function failed to deploy. A crash loop (see `handler_error` below). Firestore trigger detached after an infra change. |
| **What to do** | Redeploy functions (`pnpm deploy:functions -P prod`). The commands are still there and still `pending`; a healthy trigger does **not** re-process them (`onDocumentCreated` does not fire on existing documents), so after the fix the stuck ones must be replayed by a break-glass script that re-runs the handler for each. |
| **Never** | Mark them `applied` by hand. The command's *effect* — the event, the credit — never happened; only its label would change. |

### `handler_error` — a command was resolved as `failed` because the handler threw

| | |
|---|---|
| **What it means** | A command referenced something that does not exist, or a repository threw. The command is `failed`, with a reason. It is **not** retried (DEBT-025). |
| **What it costs** | That one check-in or attendance mark did not happen. It is visible, not silent. |
| **First look** | The `errorMessage` on the log line. A "not found" is almost always a bad QR scan or a stale client. |
| **What to do** | If it is a genuine transient failure (rare — the admin SDK retries transient gRPC internally), re-issue the command from the UI. If it recurs, it is a defect: read DEBT-025 and consider typing the refusal. |

### `projection_lag` — the daily read model is more than an hour behind the event log

| | |
|---|---|
| **What it means** | `onEventCreated` is not folding events into the dashboard's counters. |
| **What it costs** | **The dashboard is stale and renders it with total confidence.** There is no "these numbers are old" state; the owner simply reads yesterday's studio and makes today's decision with it. |
| **What to do** | `pnpm projections:rebuild` — it replays the log. Then `pnpm projections:verify`, which folds the log independently and diffs. |
| **Why this is a boring incident** | The projection is **disposable** by design: it folds events only, never state, so it can always be rebuilt. It is a cache, not a second source of truth. |
| **Never** | Hand-edit a counter. You would be inventing a number that the log does not support. |

### `credit_ledger_drift` — `credits.available` disagrees with its six counters

| | |
|---|---|
| **What it means** | **A write path bypassed the transaction.** This is a *code* defect, not a data problem. (DEBT-004) |
| **What to do** | **Find the offending write path.** The log line carries the `entitlementId`, `stored` and `derived`. Read the entitlement's event history (`/events` filtered by `related.entitlementId`) and find the movement that is not backed by an event. |
| **Never — and this one matters** | **Do not "fix" the number.** The drift check *reports*; it never repairs, and neither should you. A self-healing system hides its bugs, and the bug is the thing you need to know about. Correcting the field destroys the only evidence that a write path bypassed a transaction. |

### `booked_count_drift` — a session's `bookedCount` disagrees with its reservations

| | |
|---|---|
| **What it means** | The denormalised counter that capacity is judged against is wrong. |
| **What it costs** | Drifted high: the class silently refuses members it has room for. Drifted low: it oversells. Neither raises an error. |
| **What to do** | Same discipline as above — find the write path. The correction, when you make it, is a **compensating event**, never an overwrite. |

### `expiring_with_held` — a package reaching `validUntil` while still holding a credit

| | |
|---|---|
| **What it means** | The auto-resolution sweep did not settle a reservation before the expiry sweep reached its package (I-19). |
| **What it costs** | Nothing yet: `decideExpire` **refuses** to touch a row while `held > 0`. This alarm exists to make that refusal *visible* — the sweep protected the member, and now somebody should ask why the reservation was never resolved. |
| **What to do** | Look at the reservation. Did `nightlySweep` run? Did auto-resolution refuse it? |

---

## Procedures

### Rebuilding the projection

```bash
pnpm projections:rebuild     # replays /events into the daily read model
pnpm projections:verify      # folds the log independently and DIFFS. Expect zero.
```

Neither is a migration and neither is a backfill: they write nothing that is not already derivable
from the log. `rebuild` refuses to run against production unless `ALLOW_PRODUCTION=1` is set — a
guard, not an inconvenience.

### Deploying

There is **no default Firebase project**, on purpose. Every deploy names its target, so deploying to
production can never be something that merely *happened*.

```bash
pnpm check                                   # the gate. Never deploy around a red gate.
pnpm deploy:rules     -P staging             # rules + indexes
pnpm deploy:functions -P staging             # builds the bundle via the predeploy hook
```

The web app is **not** deployed from a terminal: App Hosting builds from git (`apphosting.yaml`).

**Indexes are a deploy step, and a missing composite index fails in production while passing in the
emulator.** Deploy rules and indexes *before* the code that queries against them.

### Rotating the QR signing key

```
1. QR_TOKEN_SECRET_PREVIOUS := the current QR_TOKEN_SECRET
2. QR_TOKEN_SECRET          := a fresh key
3. deploy                    → tokens minted seconds ago under the old key still verify
4. after sixty seconds (the TTL), remove QR_TOKEN_SECRET_PREVIOUS
```

On a **leak**, skip step 1: drop the compromised key immediately and accept that tokens minted in
the last minute die with it. Sixty seconds of failed scans is the correct price for a key a stranger
holds.

### Backup and restore

*(Provisioned at go-live, against a real project — see B5. The procedure, so it is not invented
under pressure:)*

```bash
# Scheduled daily export to Cloud Storage
gcloud firestore export gs://<bucket>/backups/$(date +%F) --project <prod>

# Restore — into a SEPARATE database or project first, never over the live one
gcloud firestore import gs://<bucket>/backups/<date> --project <staging>
```

> **A backup whose restore has never been rehearsed is not a backup.** It is a bill. The go-live
> checklist contains a restore rehearsal for exactly this reason, and it is not optional.

Note what a restore **cannot** do: the event log is append-only and authoritative. Restoring an
older snapshot does not "undo" the events written since — it loses them. A restore is a
disaster-recovery tool, not an undo button. **Undo is a compensating event** (#9), and it is v1.30.

---

## Incident response

1. **Say what is broken, in one sentence, to the owner.** Before diagnosing. She is running a
   business on this and needs to know whether to reach for pen and paper.
2. **Read the runbook entry.** It is above. If there is none, write one when the incident closes.
3. **Fix forward.** Rolling a deploy back is available (App Hosting keeps releases; Functions keep
   versions). Rolling *data* back is not — the log is append-only, and that is deliberate.
4. **A correction is a compensating event, never an overwrite** (#9), and it carries a `reason`.
5. **Write the DEBT entry before you close the incident**, with a trigger to repay. The shortcut
   taken at 21:00 on a Tuesday is exactly the one that is never written down.
