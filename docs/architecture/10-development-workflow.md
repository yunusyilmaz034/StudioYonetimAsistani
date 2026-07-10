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

## 4. Git Policy

- **One commit per milestone.** A milestone closes as a single commit.
- **Commit message format** — `feat(<scope>): <Milestone Name>`:

  ```
  feat(architecture): Architecture v1
  feat(scaffold): Phase 1 workspace
  feat(design): Design System v1
  feat(foundation): Platform Foundation
  feat(auth): Authentication
  feat(dashboard): Owner Dashboard
  feat(members): Member Management
  feat(products): Product Catalog
  feat(reservations): Reservation Engine
  feat(checkin): QR Check-in
  ```

- **A tag is created when a milestone completes**, format `vX.Y-<name>`:

  ```
  v1.0-architecture
  v1.1-scaffold
  v1.2-design-system
  v1.3-foundation
  v1.4-auth
  v1.5-dashboard
  v1.6-members
  …
  ```

- **Push happens only with the owner's approval.** Commit and tag locally; do not push unprompted.

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
- **When a decision is unclear, do not guess — stop and ask the owner.**

---

This workflow is the **default working method for all future development.**
