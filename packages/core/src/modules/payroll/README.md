# payroll — Trainer Payroll & Commission (Plus Phase 9)

**Purpose.** Compute what each trainer earned from the classes she taught and the sales attributed to
her, judged against a versioned compensation plan; let the owner adjust, finalize, and mark paid.

## The invariants this module owns

> **1. Earnings are DERIVED, never a second ledger.** A trainer's pay is computed on read from facts
> the studio already records — realised classes (scheduling + attendance) and attributed sales
> (`Sale.soldBy`). The only events this module writes are the four human decisions: set a rate,
> record an adjustment, finalize a statement, mark it paid. (roadmap Doc 32 §9 — "reuses the finance
> ledger, never a parallel accounting system".)

> **2. A rate is versioned policy data, never an `if`.** `CompensationPlan` is versioned; every
> finalized statement stamps the snapshot it was judged under (the `productSnapshot` discipline). No
> number about money lives in a source file.

> **3. The attendance-pay rule is EXPLICIT.** Whether a *presumed* attendance (system_default, AD-38)
> or a no-show pays the trainer is set on the plan (`payOnPresumed`, `payOnNoShow`), not stumbled
> into. The domain reads attendance semantics; it never re-decides them.

> **4. Finalizing is idempotent and freezes the period.** A statement is a REPORT until finalized;
> finalizing stores a frozen snapshot so later attendance corrections never silently change a
> statement the owner already paid. Re-finalizing is refused.

## Not in scope (deliberately)

No payroll PDF, no SGK / tax / accounting, and **no kasa movement** — marking a statement paid records
the fact; it does not post an expense (the finance module has no expense side, and inventing one is the
"parallel accounting system" the roadmap forbids). Wiring a real cash outflow is a future finance seam.

## Public API

- `decideSetCompensationPlan(ctx, current, input)` — validate + version a plan (pure).
- `computeStatement(input)` — the pure earnings function: realised classes × rates + attributed
  sales × commission + adjustments → a `PayrollStatementDraft`. Deterministic; idempotent.
- `decideRecordAdjustment` · `decideFinalizeStatement` · `decidePayStatement` — the money decisions.

The application loads sessions (filter by `trainerId`, derive realised = not cancelled & ended),
classifies reservations by `status`/`attendanceSource`, groups sales by `soldBy.id`, and feeds these
pure functions. Nothing here imports firebase-admin. Money is integer kuruş; commission is stamped as
an amount, rounded once (I-34), never a re-evaluated percentage.
