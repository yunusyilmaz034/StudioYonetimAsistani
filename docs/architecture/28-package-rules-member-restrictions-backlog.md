# 28 — Package Rules & Member Restrictions — **architecture backlog**

**Status:** backlog — accepted onto the roadmap (owner, 2026-07-15). **No enforcement code yet, no
new UI yet.** This is the brief the milestone will be written against when it opens. It is written
now, during production setup, because the setup revealed how much of the seam already exists — and
recording that is cheaper than rediscovering it.

---

## 1. The binding constraint

> **Two layers of rules, and the more specific one wins. The catalogue carries the DEFAULT for a
> package; the member carries an OVERRIDE for an individual. A reservation is judged against the
> member's override if one exists, otherwise the package default, otherwise the studio default.**

```
studio default  ←  package rule (catalogue)  ←  member restriction (override)
     weakest                                          strongest
```

The failure this milestone must not commit: **a member restriction that silently loosens a package
rule the owner never meant to loosen.** An override is a deliberate act on one member's card, stamped
with who did it and why (the correction/adjustment shape, AD-39) — never a default, never a guess.

---

## 2. What already exists (the seam is half-built)

The catalogue was built with two of these fields already on `Product`, and finding them during setup
is the test of whether it was built right:

| The rule the owner wants | What the code has today |
|---|---|
| Cancellation-right count per package (Reformer 8 → 3, Reformer 16 → 5, Premium → ∞) | `Product.cancellationAllowanceCount: number \| null` — **stored, mapped, round-tripped. Read by NOTHING.** |
| Max reservations per day per package | `Product.dailyReservationLimit: number \| null` — same: **stored, enforced nowhere.** |

**This is the important part: the data model already anticipates per-package limits; the decision
functions do not read them.** `reservations/domain/decide.ts` and the cancellation decider never look
at `cancellationAllowanceCount`. So today the fields are inert — a member can cancel without limit
regardless of what the package says, because the number is written down and never consulted.

That is a *seam*, exactly as Phase 1 was meant to leave it (design the extension point, build
nothing): the field is on the product snapshot, which means an entitlement already CARRIES its
package's allowance at grant time. The work is to make the decider READ it — not to reshape data.

---

## 3. What is new, and must be designed

**3.1 Package rules — finish what is started, add what is missing.**

- **Cancellation-right count** — wire `cancellationAllowanceCount` into the cancellation decider. A
  cancellation inside the free window still costs nothing in credit, but decrements the *allowance*;
  at zero, a further cancellation is refused or falls to the late-cancel path (owner's call — this is
  the decision the milestone must settle). The count lives on the entitlement (granted with the
  package), and consumed cancellations are events, so the ledger arithmetic mirrors credits:
  `cancellationsLeft = allowance − cancellationsUsed`. Never a stored mutable counter.
- **Late-cancel right** (future) — a separate allowance from the free-cancel count.
- **No-show right** (future) — how many presumed/observed no-shows before a consequence.

Each is a closed, countable allowance on the entitlement, decremented by a compensating event, never
a float, never hand-edited.

**3.2 Member restrictions — a new concept: "Kısıtlı Üyelik" on the member card.**

An optional restriction object on the member (NOT on the entitlement — it outlives any single
package), read as an override at reservation time:

- **Allowed days** — the member may only book on certain weekdays.
- **Allowed hour ranges** — and only within certain hours.
- **Max cancellation count** — overrides the package's `cancellationAllowanceCount`.
- **Max active reservations** (future) — a ceiling on concurrent open bookings.

The purpose the owner named: **VIP, corporate, promotional, or problem members** — the special case
that must be manageable without bending the catalogue's general rules for everyone. A restriction is
tenant-scoped member state, it is PII-adjacent behaviour (so it lives on `/members`, and its CHANGES
are events with a reason — never a silent edit), and it is read by the reservation decider FIRST,
before the package default.

---

## 4. The shape the enforcement must take (so it is not built wrong)

- **The decider reads the rule; the rule is never an `if` in a Server Action** (non-negotiable #4 and
  its cousins). `(state, policy, command, now) → events` stays pure: the member restriction and the
  package allowance are *inputs to the decision*, loaded before it runs.
- **Resolution order is data, not branches:** `resolve(memberRestriction, packageRule, studioDefault)`
  returns the effective rule, and the decider judges against that one value. Adding a fourth layer
  later must not touch the decider.
- **Every allowance is a ledger, not a mutable counter** — decremented by an event, rebuildable from
  the log, so a correction is a compensating event and the "why" is mandatory.
- **An override is stamped** — who set it, when, why (AD-39: closed-enum reason + note). A restriction
  that appears on a card with no author is exactly the silent loosening §1 forbids.

---

## 5. Explicitly NOT in this note

The numbers (Reformer 8 → 3, → 5, Premium → ∞) are the owner's examples, not decisions — they are set
per product in the catalogue when the feature ships, never in code (AD-41). Nothing here is scheduled;
this is the brief, to be sequenced against the frozen roadmap when the owner opens the milestone.

**Related:** [`13-entitlements-credit-ledger.md`](13-entitlements-credit-ledger.md) (the ledger
pattern this reuses) · [`14-reservations-engine.md`](14-reservations-engine.md) (where enforcement
lands) · `docs/architecture/02-domain-model.md` §15 (the invariants any allowance must not break).
