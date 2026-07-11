# 18 — Member Workspace · Design (v1.18)

> **Status: APPROVED (owner, 2026-07-11). Decisions D1/D2/D3 resolved (§8). Ready to
> implement.**
>
> Reception's single-screen operations centre for **one member**. Central object:
> **Member**. It composes the existing modules (members · entitlements · reservations ·
> checkin · payment-seam · events) into one workspace — it is not a new subsystem.
> **No new domain rule, no new event, no new decider.** v1.18 adds only **read-only**
> infrastructure (3 repository reads + 1 index) and UI.

The goal: the screen reception uses most, all day. Everything reception needs about a
member — see it, and act on it — without leaving the page.

---

## 1. Boundaries with existing screens

| Screen | Central object | Does |
|---|---|---|
| `/members` (list) | Member set | search, create, list; opens a member |
| **`/members/[id]` (v1.18)** | **one Member** | the member's full operations workspace — profile, packages, reservations, check-in, payments, audit, actions |
| `/reservations` (v1.17) | Reservation | all reservations, reservation-first |
| `/schedule` (v1.12/13) | Session | calendar + roster |
| `/checkin` (v1.15) | Branch/day | live occupancy, door |
| `/packages` (v1.14) | Product | the catalogue |

Every section **drills through** to its own workspace (UX-6, No Dead Ends). The Member
Workspace is the hub; the source screens remain the authority.

## 2. Route & shape — **D1 (resolved: dedicated full page)**

Today the member detail is a right-**Sheet** inside `/members` (`?member=<id>`), holding
only Profile + QR + Subscriptions.

**Decision (owner):** promote it to a **dedicated full-page route `/members/[id]`** —
Single Workspace (DS-8/UX-1): **desktop tabs**, **mobile accordion/sections**, identical
capability. Rationale:

- It is "the most-used screen all day" — it deserves a shareable URL, back/forward, and
  full width. Reception keeps a member open, works, moves on.
- Seven sections do not fit a comfortable Sheet on mobile.
- All existing drill-throughs (dashboard `?member=`, reservations `?member=`, check-in)
  redirect to `/members/[id]` — one canonical member destination.

**Alternative (rejected):** keep the Sheet, add tabs inside it. Cheaper, but cramped and
not URL-addressable; wrong for the daily hub. *If the owner prefers the Sheet, the same
sections/reads apply — only the container changes.*

## 3. The seven sections (locked scope)

Each section = existing data, one lens. Faz-1-out items are **marked, not built**.

**1 · Genel Bilgiler.** Profile (name, phone, e-mail, birth date, joined), contact,
emergency contact, **notes**, status (active/inactive). Header shows `MemberStats`
(last check-in, last attendance, active packages, balance due) — already denormalised on
the member doc, zero extra read. Edit → existing `MemberForm`; deactivate → existing
`deactivateMember`.

**2 · Paketler / Abonelikler.** The existing **`SubscriptionsPanel`** (v1.14): active +
past, remaining credits, valid-until, assign inline, amend/adjust/reactivate/cancel,
audit timeline per entitlement. Category wall + earliest-expiry already enforced in core.
*(Faz-1-out: freeze operations — DEBT-009.)*

**3 · Rezervasyonlar.** **All upcoming** (sessionStartsAt ≥ now) + **last 50 past**
(D3), each with session/trainer/service/status/occupancy. Quick book (reuses
`bookReservationAction` + future-session picker), cancel (reuses
`cancelReservationAction`, late-cancel warning). "Reservation Workspace'e geç" →
`/reservations`. *(Faz-1-out: move/reschedule, waitlist, recurring — deferred with
v1.17.)*

**4 · Check-in.** Is the member inside now? (`getPresence(memberId)` — doc existence),
last entry, **history of the last 90 days** (D3). **QR card** (existing `MemberQrCard`).
Quick check-in/out reuses the `checkIn.record` command (same as `/checkin`'s
member-search path). "Check-in ekranına geç" → `/checkin`.

**5 · Ödemeler (seam).** Read-only over the v1.14 payment seam: total **balance due**
(Σ `priceAgreed − paidTotal` across active entitlements), collected amounts, per-package
`manualPayment` (method, note, date) as a simple **timeline**. Uses existing
`recordPayment` / `amend` (from the Subscriptions actions). **Structured so v1.19's real
Payment aggregate replaces this panel without changing the other six sections** — the
panel reads from a small adapter that today derives from entitlements and later reads the
payment module. *(Faz-1-out: real collect/refund/void/allocation — v1.19.)*

**6 · İşlem Geçmişi (audit timeline).** The member's important actions — a
**read-only** event list via `listMemberEvents` (`events.where('related.memberId','==',
id)`, sorted desc, **last 100** (D3), same pattern as `listEntitlementEvents`). Renders
event **type + time + actor** only — **PII-free by construction** (events carry no PII,
non-negotiable #6). Curated display types: member.created/updated, entitlement.\*,
reservation.\*, member.checked_in/out. Not a projection doc — a direct bounded event
read.

**7 · Hızlı Aksiyonlar.** A single action bar, all wired to **existing** writes:
Rezervasyon oluştur (`bookReservationAction`) · Check-in (`checkIn.record`) · Paket ata
(`assignSubscription`) · Ödeme al (`recordPayment`) · QR yazdır (`MemberQrCard`) ·
Düzenle (`MemberForm`). No new action.

## 4. Read / query model — the crux

One web query module `apps/web/src/server/member-workspace-query.ts` →
`loadMemberWorkspace(ctx, memberId, nowMs)`, fanning out **bounded parallel reads**
(dashboard pattern, **not** a projection):

| # | Data | Method | Status |
|---|---|---|---|
| 1 | member | `MemberRepository.findById` | ✅ exists |
| 2 | packages | `EntitlementRepository.listByMember` | ✅ exists (index exists) |
| 3 | reservations | **`ReservationRepository.listByMember(memberId)`** | 🔧 **new read** — index **already provisioned** (`reservations memberId+sessionStartsAt`) |
| 4a | inside now | `CheckinRepository.getPresence(memberId)` | ✅ exists |
| 4b | check-in history | **`CheckinRepository.listCheckInsByMember(memberId, since)`** | 🔧 **new read + new index** `checkIns memberId+occurredAt` |
| 5 | payment-seam | derived from #2 (`manualPayment`,`priceAgreed`,`paidTotal`) | ✅ exists |
| 6 | audit | **`listMemberEvents(memberId)`** (`related.memberId ==`) | 🔧 **new read** — equality → auto-indexed, **no composite index** |

**Read budget (D2, accepted).** ~6 parallel reads. This is a detail screen, not the owner
dashboard, so the 1-read rule does not apply — bounded parallel reads are the accepted
pattern (as the dashboard). No new projection or aggregate; existing modules joined by
read-only queries.

**Bounds are centralised config, not scattered literals (owner).** The three D3 limits
live in **one** exported object, not sprinkled through the code:

```ts
// apps/web/src/server/member-workspace-query.ts
export const MEMBER_WORKSPACE_LIMITS = {
  checkInHistoryDays: 90,    // §3.4
  pastReservations: 50,      // §3.3
  auditEvents: 100,          // §3.6
} as const
```

These are **read/display bounds, not credit-affecting policy** — so they are query
config, not versioned domain `policy` (non-negotiable #4 governs credit decisions, which
these do not touch). One place to change them; the query and repositories take them as
parameters.

**These three additions are read-only.** They touch `infrastructure/` repositories only —
**no domain change, no new event, no new decider.** "Use the existing modules" is
honoured: we add reads to existing modules, we do not add rules.

## 5. Write actions — all existing

`bookReservationAction` · `cancelReservationAction` · `checkIn.record` (command) ·
`assignSubscription` / `amendEntitlement` / `adjust` / `reactivate` / cancel ·
`recordPayment` · `deactivateMember` · `MemberForm` (create/update). **No new action,
no new decider.**

## 6. Mobile / Desktop UX

Single Workspace (UX-1, DS-8): desktop **tabs** across the seven sections with a sticky
member header; mobile **accordion/sections** in one scroll, capability identical (UX-2/7).
Mobile-first, verified at 375 · 430 · 768 · 1280. Owner/reception run it fully from a
phone. Inline editing everywhere (UX-5); every edit still emits its event. No dead ends
(UX-6): each section drills to its source workspace.

## 7. New core additions (read-only)

1. `ReservationRepository.listByMember(ctx, memberId)` — by `memberId` + `sessionStartsAt`
   (index exists). Split upcoming/past in the query layer.
2. `CheckinRepository.listCheckInsByMember(ctx, memberId, since)` — **new index**
   `checkIns (memberId ASC, occurredAt DESC)` → `firestore.indexes.json`, `pnpm deploy:rules`.
3. `listMemberEvents(ctx, memberId)` — new read (mirrors `listEntitlementEvents`),
   `related.memberId ==`, in-memory sort. No composite index.

Ports/interfaces updated for 1–2; each gets a fake-repo unit test. Security rules
unchanged (reads are tenant-scoped, existing collections).

## 8. New domain decisions

**None.** No invariant, no event schema, no credit arithmetic is touched. The three
**product/UX/architecture** decisions are resolved by the owner (2026-07-11):

- **D1 — route shape:** ✅ dedicated `/members/[id]` full page; existing `?member=`
  drill-throughs redirect to it.
- **D2 — read budget:** ✅ ~6 bounded parallel reads; no new projection/aggregate.
- **D3 — history bounds:** ✅ check-in last **90 days** · reservations **all upcoming +
  last 50 past** · audit **last 100** — centralised in `MEMBER_WORKSPACE_LIMITS` (§4),
  no scattered literals.

## 9. Out of scope (Faz-1 — marked, not built)

Reservation move/waitlist/recurring (deferred w/ v1.17) · real Payments aggregate
(v1.19) · freeze operations (DEBT-009) · staff/role management (v1.22) · cross-member
bulk actions · any new domain rule or event.

## 10. Validation & risks

- `pnpm check` + `next build` green; responsive at the four breakpoints; new reads get
  fake-repo unit tests.
- **Risk — audit read scale:** `listMemberEvents` fetches a member's events and sorts in
  memory (like `listEntitlementEvents`). A very long-tenured member accrues many events;
  acceptable for Phase 1, add a `limit` if it grows. Logged if bounded.
- **Risk — no live runtime verification** (emulator/Java absent): static validation only.
  The new `checkIns memberId+occurredAt` index must be verified on deploy (§7).
- **Risk — drill-through migration:** promoting to `/members/[id]` (D1) means updating the
  existing `?member=` links (dashboard, reservations). Mechanical; covered by build.
