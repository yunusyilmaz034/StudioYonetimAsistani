# 10 — Development Workflow v1

**Status:** binding — the default way of working on this project
**Date:** 2026-07-10

This document governs **how** work happens here. It sits beside the architecture docs, not above them: architecture decides *what* is correct (Doc 01–09), this decides *how* we get there safely. When a session starts, this is the operating manual.

---

## 1. What this project is

**This is no longer a "Studio Management App." It is a Studio Operating System.**

> **Studio Operating System is an owner-first platform that runs daily operations, records every meaningful business event, reduces manual work, and turns studio data into decisions.**

Every architecture, implementation, and UX decision from here on serves that vision. The reservation system remains infrastructure; the product is the operating system the owner runs her business on.

---

## 2. Development Principles

1. **The roadmap does not change.** A new milestone may be *proposed*, but it is not added to the roadmap without the owner's approval.
2. **Scope discipline.** Work only on the active milestone. Do not drift out of scope, do not add business features, do not perform future optimisation.
3. **Mobile first.** Owner, Admin, and Reception use the product heavily from a phone. Every screen is designed for mobile first, then widened to tablet and desktop (Doc 09 §9).
4. **Responsive is mandatory.** Every screen is verified at **375 · 430 · 768 · 1280** px.
5. **Architecture comes first.** Code conforms to the architecture. The architecture is not bent to fit the code.
6. **Documentation never lags behind the code.** A change that lands without its doc update is not done.
7. **`pnpm check` is green at the end of every milestone.** Typecheck, lint, dependency-cruiser, unit tests.
8. **`main` is always in a working state.** A broken build, broken typecheck, broken lint, or a failing test never enters `main`.

---

## 3. Milestone Policy

Every milestone advances in this exact order:

```
Plan  →  UX  →  Implementation  →  Validation  →  Commit  →  Stop
```

- **Plan** — state the scope and approach; get approval before building.
- **UX** — for anything with a screen, the mobile-first design and states come before implementation.
- **Implementation** — build only what the milestone needs.
- **Validation** — `pnpm check` green; the app compiles and runs; responsive verified at the four breakpoints where screens changed.
- **Commit** — a single commit closing the milestone (§4).
- **Stop** — **never advance to the next milestone automatically.** Ask the owner for approval at the end of every milestone.

---

## 4. Versioning & Git Policy

**Every milestone is a product version.** New milestones continue the same scheme.

> **Roadmap re-prioritised for cutover (2026-07-11).** The goal is **not** the most
> technically perfect system — it is to onboard the first live customer safely. The
> forward order (v1.17→) is sequenced toward that go-live, owner-approved.

**Completed (tagged, pushed):**

| Version | Milestone | Tag |
|---|---|---|
| **v1.0–v1.3** | Architecture · Scaffold · Design System · Workflow | `v1.0-architecture` … `v1.3-development-workflow` |
| **v1.4** | Platform Foundation | `v1.4-platform-foundation` |
| **v1.5** | Authentication & Authorization | `v1.5-authentication-authorization` |
| **v1.6** | Member Management | `v1.6-member-management` |
| **v1.7** | Scheduling Foundation | `v1.7-scheduling-foundation` |
| **v1.8** | Entitlements & Credit Ledger | `v1.8-entitlements-credit-ledger` |
| **v1.9** | Reservations Engine | `v1.9-reservations-engine` |
| **v1.10** | Automation (triggers · sweeps) | `v1.10-automation` |
| **v1.11** | Attendance & Correction Workspace | `v1.11-attendance-workspace` |
| **v1.12** | Scheduling Workspace / Calendar | `v1.12-scheduling-workspace` |
| **v1.13** | Booking UI | `v1.13-booking-ui` |
| **v1.14** | Package Catalogue + Manual Subscription | `v1.14-catalogue-subscriptions` |
| **v1.15** | QR Access & Check-in | `v1.15-qr-checkin` |
| **v1.16** | Owner Dashboard | `v1.16-owner-dashboard` |
| **v1.17** | Reservation Workspace | `v1.17-reservation-workspace` |
| **v1.18** | Member Workspace | `v1.18-member-workspace` |
| **v1.19** | Calendars & Session Workspace | `v1.19-calendars-session-workspace` |
| **v1.20** | Owner UI & Design System — Premium Redesign | `v1.20-premium-design-system` |
| **v1.21** | Member Portal & Auth (+ the domain corrections it forced: D12–D14) | `v1.21-member-portal` |

**Planned (re-prioritised after the owner UI review, 2026-07-11).** The class and
reservation calendars are the studio's most-used operations screens and the member's
own reservation experience is the product's most success-critical surface — so the
calendar/reservation experience comes next, ahead of a real Payments aggregate. Payments
is **deferred, not dropped** — the v1.14 manual-payment seam keeps working until then.

The calendar milestone is **split** (owner, 2026-07-11): the two calendars + Session
Workspace ship first; the member portal + member auth follow as their own milestone so
member authentication is delivered safely on its own.

| Version | Milestone | Scope |
|---|---|---|
| **v1.22** | **Payments** *(deferred from v1.19)* | A real payment aggregate — collect · refund · void · methods · balance allocation · payment timeline; architecture ready for POS / online later. Used from within the Member Workspace. Until it lands, the v1.14 manual-payment seam stands. |
| **v1.23** | **Migration & Cutover** | Import from the old system · data validation · the first live-customer cutover (freeze-and-cut, Doc 8 §5). |
| **v1.24** | **Production Hardening / CI** | Emulator + Firebase integration tests · production config · monitoring · backup · CI/CD · performance & security checks. |
| **v1.25** | **Staff & Identity** | Staff accounts · roles · authorization · audit · multi-user management. |

- **One commit per milestone.** A milestone closes as a single commit, Conventional Commit format — `feat(<scope>): …` for feature milestones, `docs(<scope>): …` for docs-only ones. For example:

  ```
  feat(scaffold): Phase 1 workspace
  feat(design): Design System v1
  docs(workflow): establish development workflow v1
  feat(foundation): platform foundation
  feat(auth): authentication & authorization
  feat(members): member management
  feat(reservations): reservation engine
  feat(checkin): QR check-in
  feat(credits): credit engine
  ```

- **A tag is created when a milestone completes**, format `vX.Y-<slug>`:

  ```
  v1.0-architecture
  v1.1-scaffold
  v1.2-design-system
  v1.3-development-workflow
  v1.4-platform-foundation
  v1.5-auth
  v1.6-members
  v1.7-reservations
  v1.8-checkin
  v1.9-credits
  v2.0-mvp
  ```

- **Commit, tag, and push each require the owner's approval.** Nothing is committed, tagged, or pushed automatically — the owner is asked at each of the three gates.

---

## 5. Work Quality — the end-of-milestone summary

Every milestone ends with this summary, in this order:

- **Changed files**
- **Architectural changes made**
- **Components added**
- **Remaining technical debt**
- **Known risks**
- **`pnpm check` result**
- **Commit hash**
- **Next proposed milestone**

---

## 6. Quality Rules

- Working code is worth more than quickly-written code.
- Readable code is worth more than short code.
- Architectural consistency is worth more than short-term convenience.
- Every commit must be revertible.
- `main` must always be deployable.
- At the end of every milestone the app must compile and run.
- Break large changes into small, independent milestones.
- Do not refactor unnecessarily; change only as much as the active milestone needs.
- **The Single Workspace Principle is the default UX for every business module.** A business object (Member, Reservation, Staff, Service, Room, Package, …) is managed inside **one workspace** — everything about it is visible and editable in that one place, with minimal page transitions and popups. Desktop uses tabs; mobile renders the same workspace as accordions / sections / Sheets with no loss of capability. Every in-place edit still emits its event. This is a permanent, product-level decision; the full rule and its rationale are **Doc 09 §7 and DS-8**. It is one of the binding **Product UX Principles (Doc 12, UX-1…UX-9)** — Single Workspace, Mobile-First, Scheduling UX, Information Density, Inline Editing, No Dead Ends, Responsive Consistency, Owner First, Attendance Speed — which every business module obeys by default.
- **When a decision is unclear, do not guess — stop and ask the owner.**

---

This workflow is the **default working method for all future development.**
