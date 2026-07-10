# 09 — Design System v1

**Status:** v1 — foundations only
**Depends on:** [05 — Folder Structure](./05-folder-structure.md), [06 — Development Principles](./06-development-principles.md)
**Date:** 2026-07-10

---

## 1. Purpose

This document defines the **visual and interaction language** of the product. It is binding on `apps/web` and on every client that comes after it (Flutter, Phase 2).

It is a **foundations** document, not a component encyclopedia. Phase 1 builds tokens, typography, and a small set of primitives — nothing business-specific. The reception screens, the owner dashboard, the roster: those are built later (Doc 5 §11, Doc 8 Days 5–6), on top of what is defined here.

Two rules outrank everything else in this document:

> **1. Function before decoration.** This is an operational tool that runs a studio's day. A screen that is beautiful and slow has failed. A screen that is plain and fast has not.
>
> **2. Mobile first, always.** Every screen is designed at 375px first, then widened to tablet and desktop — never the reverse (§9). Owner, admin, and reception all run this product from a phone; a screen that only works on a laptop is a screen that is broken for most of the people using it.

---

## 2. Product Character

The product is described by exactly five words:

**Modern · Warm · Clear · Lively · Premium**

The design language draws from four references, each for one specific quality — never copied wholesale:

| From | We take | We do not take |
|---|---|---|
| Flyby Global | warmth, approachability, the feeling that software can be friendly | its pink-forward identity or its screens |
| Stripe | information hierarchy — the eye always knows what matters first | its marketing gloss |
| Apple | restraint — nothing on screen that does not earn its place | oversized hero typography |
| Linear | operational clarity — dense, fast, keyboard-legible | — |

**This is not a women-only pilates app.** It is a multi-tenant SaaS sold to gyms, studios, and boutique fitness businesses of every kind. The visual identity is therefore **gender-neutral and scalable**. Nothing in the system may assume the first customer's category, palette, or clientele (CLAUDE.md).

**Nor is it a desktop app with a phone view bolted on.** Owner, admin, and reception all use it heavily from a phone — the owner checking the day between errands, reception working the desk from a tablet, an admin approving something on the move. Every workflow in Phase 1 must be **fully usable at 375px** (§9). This is not a member-portal nicety; it is how the paying staff run their business.

---

## 3. Color Tokens

Colors are **semantic CSS variables**. A component references a role (`primary`, `danger`, `muted`), never a hex value.

> **A hex literal in a component is a defect, not a style choice.** The palette can then be retuned — or, later, themed per tenant — in one file, without touching a single component.

### v1 palette

| Semantic role | Token | Value |
|---|---|---|
| Brand primary | `--color-primary` | `#0F9F96` |
| Primary hover | `--color-primary-hover` | `#0C837C` |
| Primary soft (tint bg) | `--color-primary-soft` | `#E8F7F5` |
| Primary contrast text | `--color-primary-foreground` | `#FFFFFF` |
| Main text | `--color-foreground` | `#17202A` |
| Muted text | `--color-muted-foreground` | `#667085` |
| App background | `--color-background` | `#F7F8FA` |
| Surface (cards, sheets) | `--color-surface` / `--color-card` | `#FFFFFF` |
| Border | `--color-border` | `#E4E7EC` |
| Success | `--color-success` | `#16A34A` |
| Warning | `--color-warning` | `#D97706` |
| Danger | `--color-danger` | `#DC2626` |
| Info | `--color-info` | `#2563EB` |

Tokens live in `apps/web/src/app/globals.css`. That file holds **tokens and the minimal base layer only** — no component styles, no utilities.

**No dark mode in Phase 1.** It is an explicit prohibition (§12). The token set is single-theme; a `.dark` variant is not defined, so nothing can accidentally depend on one.

---

## 4. Typography

**Typeface: Geist** (`geist/font/sans`), wired through Next's font pipeline into `--font-sans`.

Hierarchy is **strong and clear**, but restrained — this is an application, not a landing page.

| Use | Size | Notes |
|---|---|---|
| Default body (operational desktop) | **14px** | the working size for tables, forms, dense screens |
| Reading comfort | **16px** | member notes, longer prose, mobile |
| Section / card title | 16–18px, semibold | |
| Page title | 20–24px, semibold | the ceiling — see below |

**No oversized marketing headings inside the application.** A 48px hero belongs on a website, not above a reservation table. The page title is the largest type a working screen shows.

Weight and color carry hierarchy as much as size: `foreground` + semibold for what matters, `muted-foreground` for what supports it.

---

## 5. Shape & Spacing

- **8px spacing grid.** All spacing is a multiple of 8 (Tailwind's even steps: `2 = 8px`, `4 = 16px`, `6 = 24px`). 4px is allowed only for tight intra-control gaps.
- **Radius:** controls (button, input, badge) = **8px** (`--radius-control`); cards, drawers, dialogs = **12px** (`--radius-card`).
- **Avoid pill shapes.** A fully-rounded control reads as consumer/marketing. Badges and buttons are 8px-rounded, not pills.
- **Borders over shadows.** Structure is drawn with `--color-border`, not elevation. A card is a bordered surface, not a floating one.
- **Shadows are subtle and rare** — reserved for things that genuinely float above the page: overlays, drawers, floating menus, toasts. Never on a static card.

---

## 6. Motion

**Minimal, and fast.** No animation exceeds **150ms**. Motion is confined to overlays entering/leaving (drawer slide, dialog fade) and to state feedback. **Decorative animation that slows an operational workflow is prohibited** (§12) — reception taps hundreds of times a day, and every wasted 100ms is felt.

---

## 7. UX Rules

These are binding on every screen built on this system.

**The Single Workspace Principle — the governing UX law.** A business object (Member, Reservation, Staff, Service, Room, Package, …) is managed, as far as possible, inside **one workspace**. Opening the object surfaces *everything about it* in that one place, and every piece of it is editable there. The owner does not travel between pages to assemble a picture of one thing, and does not lose context to a stack of popups.

- **One object, one surface.** Everything related to the object — its fields, its related records, its history — lives in the same workspace. Related data is edited in place, not on a separate page.
- **Minimise page transitions and popups.** A workspace collapses what used to be several screens. A modal is still only a confirmation or a short focused task (§ the drawer/modal rule below); it is never how you reach the object's own data.
- **Audit is untouched.** A workspace is a *presentation* of state, not a bypass of it. Every edit made inside it still goes through the normal command → decision → event path and still writes its event. Convenience never costs the log.
- **Responsive is mandatory and lossless.** On **desktop**, a tabbed workspace is the norm. On **mobile**, the *same* workspace renders as accordions / stacked sections / Sheets — the same information and the same edit capability, no feature dropped (§9). If a capability exists on desktop and not on mobile, the workspace is not done.

This is the **default UX for every business module.** It refines the Detail-page template (§8, template 2): for a rich business entity the "detail" surface *is* its workspace, and it may be a dedicated route rather than a narrow side drawer when the object carries enough to warrant tabs.

**Labels are explicit.** An action button names its action:

- ✅ "Yeni Rezervasyon" · "Rezervasyonu Oluştur" · "Paketi Pasife Al"
- ❌ "Yeni" · "Tamam" · "Kaydet" *(when the action can be named)*

**Frequent actions are visible.** The primary action of a screen is a button, never buried in a three-dot menu. Overflow menus hold rare actions only.

**Drawers for detail and edit; modals for confirmation.**
- A **side drawer** (Sheet) is the default for viewing or editing a record — it keeps the list in context.
- A **modal dialog** is only for a confirmation or a short, focused task.
- **Never a modal inside another modal.** If a flow needs that, it needs a drawer or a step.

**Tables are operational.** Readable and dense, not decorative. Aligned numbers, clear column headers, a legible row height — a tool reception reads all day, not a showpiece.

**Destructive actions are confirmed.** Deactivating a package, cancelling, refunding — each requires an explicit confirmation naming what will happen.

**Status is never color alone.** A red dot is a red dot to a color-blind user. Every status carries a **label or icon** in addition to color (accessibility, and honesty).

**Four states are mandatory** on every data surface: **loading, empty, success, error.** An empty table with no empty-state is a bug, not a blank slate. These are not optional polish; they are the difference between a tool that explains itself and one that leaves reception guessing.

---

## 8. Standard Page Patterns

Six templates. Every screen is an instance of one of these; a screen that fits none is a design question to raise, not to improvise. **Each template is defined mobile-first — the mobile behaviour is the spec, the desktop layout is the widening** (§9).

| # | Template | Mobile (375px) — the baseline | Desktop — the widening |
|---|---|---|---|
| 1 | **List page** | Card/list rows (never a wide table); filters behind a **Filter** button that opens a Sheet | Table with columns; filters inline above it |
| 2 | **Detail page** | Full-screen Sheet **or** a separate route — never a cramped side panel | Side drawer (Sheet) over the list |
| 3 | **Form page** | **Single column**; primary submit in a sticky bottom action bar | One or two columns; submit inline |
| 4 | **Operational dashboard** | Stacked cards, one per row, most-urgent first | Grid of cards |
| 5 | **Calendar / schedule** | **Agenda / list view by default** (a month grid is unusable at 375px) | Month/week grid, agenda still available |
| 6 | **Kiosk / check-in** | Touch-first, large controls, one action per screen | Same — kiosk is touch at every size |

### List page anatomy (the most common)

Every list page follows the same top-to-bottom structure, so staff never relearn a screen. Read the two columns as **one design at two widths**, not two designs:

```
  MOBILE (≤ md)                          DESKTOP (≥ md)
┌───────────────────────────┐          ┌─────────────────────────────────────────────┐
│ Title        [Primary]    │          │  Page title                 [Primary action] │  ← PageHeader
│ [🔍 search] [Filter ▾]    │          ├─────────────────────────────────────────────┤
├───────────────────────────┤          │  Filters / search  (inline)                  │
│ ┌───────────────────────┐ │          ├─────────────────────────────────────────────┤
│ │ Card row              │ │          │  Table                                       │
│ │ Card row              │ │          └─────────────────────────────────────────────┘
│ └───────────────────────┘ │                  └── row click ──▶  Detail drawer (Sheet)
│  Filter ▾ opens a Sheet   │
│  row tap ▶ full-screen    │
└───────────────────────────┘
```

Page title + primary action → search/filter → content → detail. On mobile the **table becomes cards** and the **filters move into a Sheet**; on desktop the table and inline filters return. Same information, same order, no horizontal scroll (§9).

---

## 9. Responsive — Mobile First (mandatory)

> **Responsive is not a feature added later. It is where every screen starts.** You design at 375px, make it complete there, then widen. A screen built desktop-first and "made responsive" afterwards is rebuilt, not adjusted — and it always shows.

This applies to **all of Phase 1**, not just the member portal. Owner, admin, and reception run the product from phones; the earlier "reception is desktop-first" note is **superseded** by this section.

### The mandate

**Every primary workflow must be fully usable at 375px.** If a task cannot be completed on a 375px screen without frustration, the screen is not done.

### The rules

| Rule | What it means |
|---|---|
| **No horizontal scroll** in a primary workflow | Ever. A workflow that scrolls sideways at 375px is a defect (§11). Wide content scrolls *inside its own container*, the page never does. |
| **Tables → cards on mobile** | A desktop data table becomes a **card/list** view below `md`. Reception reads rows as cards on a phone, columns on a desktop. |
| **Filters → Sheet on mobile** | Below `md`, filters live behind a **Filter** button that opens a Sheet/Drawer. They do not consume vertical space above the content. |
| **Detail → full-screen Sheet or route on mobile** | A detail/edit view is a full-screen Sheet or its own page on mobile — never a cramped side panel. On desktop it is a side drawer. |
| **Calendar → agenda by default on mobile** | A month grid is unusable at 375px. Mobile defaults to an **agenda/list** view; the grid is a desktop affordance. |
| **Forms → single column on mobile** | One field per row. Multi-column form layouts are a desktop-only widening. |
| **Sticky bottom action bar** for critical actions | On mobile, the primary submit/confirm may pin to the bottom of the viewport, inside the thumb zone, so it is always reachable. |
| **Sidebar → Drawer / Bottom Nav on mobile** | A desktop sidebar collapses into a Drawer, or the top-level destinations become a bottom navigation bar. Never a fixed sidebar eating a phone's width. |
| **FAB only for a true primary action** | A floating action button is allowed **only** when it is genuinely the screen's one primary action. It is not decoration and not a catch-all. |
| **Touch target ≥ 44×44px** | Any control a finger touches is at least 44×44px on touch. Compact desktop densities (e.g. a 32px button) are a pointer affordance; a control used as a mobile tap target is sized up (full-width and/or ≥44px tall) or has its hit area extended to 44px. |
| **Thumb zone** | The most frequent actions sit within comfortable thumb reach — the bottom two-thirds of the screen — not stranded in a top corner. |

### The breakpoints — every screen is verified at all four

| Width | Represents | Must show |
|---|---|---|
| **375px** | small phone (the baseline) | the complete mobile layout: cards, sheet-filters, single-column forms, no horizontal scroll |
| **430px** | large phone | the same mobile layout, comfortably |
| **768px** | tablet | the transition — inline filters and tables may begin to appear (`md`) |
| **1280px** | desktop | the full widened layout |

A screen is not "done" until it has been checked at all four. Tailwind's default breakpoints map cleanly: base = mobile, `md:` (768px) = tablet, `lg:`/`xl:` = desktop. **375px and 430px share the base (un-prefixed) styles** — get the base right and both phone widths are covered.

---

## 10. Component Policy

**shadcn/ui primitives, adapted through tokens.** Installed the standard way (shadcn CLI), then bound to the semantic tokens of §3 — never to hardcoded values.

### The v1 foundation set — and only this

Phase 1 creates the **minimum foundations** and nothing more:

`Button` · `Input` · `Select` · `Textarea` · `Checkbox` · `Badge` · `Card` · `Table` styling · `Sheet` (drawer) · `Dialog` · `Toast` (Sonner) · `EmptyState` · `PageHeader`

**No business-specific components yet.** No `MemberCard`, no `ReservationRow`, no `CreditBadge`. Those are built when the screens that need them are built, so their shape is driven by a real requirement rather than guessed at now.

Toasts use **Sonner** (shadcn's current default). `EmptyState` and `PageHeader` are the two thin house components the foundation set adds on top of shadcn, because §7 makes them mandatory furniture.

### Responsive obligations of the foundation set

Mobile-first (§9) is met by **composition**, not by new components — the foundation primitives already carry what is needed:

- **Table** is a desktop presentation. A list screen renders **cards below `md` and the `Table` at `md`+** (Tailwind `hidden md:block` / `md:hidden`), from the *same* data. `Table` is never shown at 375px.
- **Sheet** is the mobile home for both **filters** (a Filter trigger opens it) and **detail/edit** (full-screen on mobile via `side` + width utilities). One primitive, two mobile jobs.
- **Dialog** stays for short confirmations at every width; it is not a mobile detail container (that is a Sheet).
- **Button / Input / Select / Checkbox** are touch-sized where they are tap targets: full-width and/or `min-h-11` (44px) on mobile, compact on desktop. The base heights are a desktop density; the mobile size-up happens at the usage site until a business screen proves a different default is needed.
- **PageHeader** stacks its title and primary action on mobile and puts them on one row at `sm`+ (already built this way).

**No mobile-only duplicate components.** There is no `MobileTable` or `MobileFilters`; the same primitive adapts by breakpoint. A second component is a second thing to keep in sync, and mobile-first does not need one.

---

## 11. Prohibited Visual Patterns

Each of these is a build-review reject, not a preference:

- Pink as the primary brand color
- Gradients
- Neon palettes
- Excessive shadows
- Excessive rounded / pill cards
- A different visual style on each page
- Arbitrary Tailwind color, spacing, or radius values *(use tokens)*
- Decorative animation that slows an operational workflow
- **Dark mode** *(Phase 1)*
- **Horizontal scroll in a primary workflow** *(§9 — wide content scrolls inside its own container, never the page)*
- **A desktop table shown at 375px** *(use the card/list view below `md`)*
- **Responsive treated as an afterthought** — designing desktop-first and shrinking
- **A touch target smaller than 44×44px** where a finger taps

---

## 12. The Showcase

`apps/web/src/app/design-system/` renders the foundation set in all mandatory states (default, loading, empty, success, error, destructive-confirm) **and demonstrates the mobile-first patterns of §9**: the responsive list (cards below `md`, table at `md`+ from one dataset), search with filters in a Sheet, a single-column form, and a sticky bottom action bar in a mock 375px viewport. It is a **development-only** surface — guarded so it returns 404 in a production build — and it is the visual contract: if a component does not look right here, or scrolls sideways at 375px, it does not ship.

**Check it at all four breakpoints — 375 / 430 / 768 / 1280 px — before trusting a component.** It is not a business screen and carries no business logic.

---

## 13. Decisions

| # | Decision | Rejected alternative | Rationale |
|---|---|---|---|
| **DS-1** | Semantic CSS-variable tokens; **no hex literal in any component** | Hardcoded Tailwind colors | The palette retunes — and later themes per tenant — in one file, without touching components. |
| **DS-2** | shadcn/ui via the **standard CLI**, adapted through tokens | Hand-vendored components | Standard install, no bespoke component code to maintain; customization limited to tokens and the three constraints below. |
| **DS-3** | **No dark mode in Phase 1** | Ship both themes | A theme nobody asked for is surface area and a second QA pass. The token set stays single-theme so nothing depends on a `.dark`. |
| **DS-4** | Motion capped at **150ms**, overlays only | Library-default (~200ms) transitions | Reception taps all day; decorative motion is a tax on every interaction. |
| **DS-5** | `EmptyState` + `PageHeader` are the only house components in v1 | Build them per screen | §7 makes them mandatory on every list/data screen; defining them once keeps every screen consistent. |
| **DS-6** | **Mobile-first is mandatory across all of Phase 1** — design at 375px, then widen | Desktop-first with a phone view added later; or "reception is desktop-first" | Owner, admin, and reception all work from phones. A retrofitted phone view is a rebuild, and it shows. Supersedes the earlier per-role priority table. |
| **DS-7** | Responsiveness is achieved by **breakpoint composition of the existing primitives** (`hidden md:block` cards↔table, Sheet-hosted filters/detail), verified at 375 / 430 / 768 / 1280 | Mobile-only duplicate components (`MobileTable`, `MobileFilters`) | One primitive that adapts beats two that must be kept in sync. |
| **DS-8** | **The Single Workspace Principle** — a business object is managed inside one workspace (tabs on desktop, accordion / section / Sheet on mobile), with all related data edited in place; product-level and permanent | Object data scattered across separate pages reached by navigation and popups | The owner sees everything about one thing in one place and edits it without losing context; page/popup hopping is the tax we refuse to charge. Every in-place edit still emits its event — presentation, not a bypass of the log. |

**Necessary deviations from raw shadcn CLI output**, all forced by the rules above: the generated **dark-mode block is removed** (DS-3), the **palette values are replaced** with §3 (DS-1), and **animation durations are capped at ≤150ms** (DS-4). Everything else stays standard shadcn.
