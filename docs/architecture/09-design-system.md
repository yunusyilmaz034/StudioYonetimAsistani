# 09 — Design System v1

**Status:** v1 — foundations only
**Depends on:** [05 — Folder Structure](./05-folder-structure.md), [06 — Development Principles](./06-development-principles.md)
**Date:** 2026-07-10

---

## 1. Purpose

This document defines the **visual and interaction language** of the product. It is binding on `apps/web` and on every client that comes after it (Flutter, Phase 2).

It is a **foundations** document, not a component encyclopedia. Phase 1 builds tokens, typography, and a small set of primitives — nothing business-specific. The reception screens, the owner dashboard, the roster: those are built later (Doc 5 §11, Doc 8 Days 5–6), on top of what is defined here.

The one rule that outranks everything else in this document:

> **Function before decoration.** This is an operational tool that runs a studio's day. A screen that is beautiful and slow has failed. A screen that is plain and fast has not.

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

Six templates. Every screen is an instance of one of these; a screen that fits none is a design question to raise, not to improvise.

1. **List page**
2. **Detail page**
3. **Form page**
4. **Operational dashboard**
5. **Calendar / schedule**
6. **Kiosk / check-in screen**

### List page anatomy (the most common)

Every list page follows the same top-to-bottom structure, so reception never relearns a screen:

```
┌─────────────────────────────────────────────┐
│  Page title                 [Primary action] │   ← PageHeader
├─────────────────────────────────────────────┤
│  Filters / search                            │
├─────────────────────────────────────────────┤
│  Content / table                             │
└─────────────────────────────────────────────┘
        └── row click ──▶  Detail drawer (Sheet)
```

Page title + primary action → filters/search → content/table → detail drawer. Nothing else competes for the top of the screen.

---

## 9. Responsive Priorities

Built per role, because the roles work on different devices:

| Surface | Priority | Why |
|---|---|---|
| **Reception** | Desktop & tablet first | the front desk runs on a tablet or a desktop all day |
| **Owner dashboard** | **Mobile-friendly from day one** | the owner checks it on her phone between other things |
| **Trainer views** (Phase 2) | Mobile-first | a phone at the studio door |
| **Kiosk / check-in** | Touch-first, large controls | a member taps it unattended |

**Minimum touch target: 44px.** Non-negotiable on any control a finger touches.

---

## 10. Component Policy

**shadcn/ui primitives, adapted through tokens.** Installed the standard way (shadcn CLI), then bound to the semantic tokens of §3 — never to hardcoded values.

### The v1 foundation set — and only this

Phase 1 creates the **minimum foundations** and nothing more:

`Button` · `Input` · `Select` · `Textarea` · `Checkbox` · `Badge` · `Card` · `Table` styling · `Sheet` (drawer) · `Dialog` · `Toast` (Sonner) · `EmptyState` · `PageHeader`

**No business-specific components yet.** No `MemberCard`, no `ReservationRow`, no `CreditBadge`. Those are built when the screens that need them are built, so their shape is driven by a real requirement rather than guessed at now.

Toasts use **Sonner** (shadcn's current default). `EmptyState` and `PageHeader` are the two thin house components the foundation set adds on top of shadcn, because §7 makes them mandatory furniture.

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

---

## 12. The Showcase

`apps/web/src/app/design-system/` renders the foundation set in all mandatory states (default, loading, empty, success, error, destructive-confirm). It is a **development-only** surface — guarded so it returns 404 in a production build — and it is the visual contract: if a component does not look right here, it does not ship.

It is not a business screen and carries no business logic.

---

## 13. Decisions

| # | Decision | Rejected alternative | Rationale |
|---|---|---|---|
| **DS-1** | Semantic CSS-variable tokens; **no hex literal in any component** | Hardcoded Tailwind colors | The palette retunes — and later themes per tenant — in one file, without touching components. |
| **DS-2** | shadcn/ui via the **standard CLI**, adapted through tokens | Hand-vendored components | Standard install, no bespoke component code to maintain; customization limited to tokens and the three constraints below. |
| **DS-3** | **No dark mode in Phase 1** | Ship both themes | A theme nobody asked for is surface area and a second QA pass. The token set stays single-theme so nothing depends on a `.dark`. |
| **DS-4** | Motion capped at **150ms**, overlays only | Library-default (~200ms) transitions | Reception taps all day; decorative motion is a tax on every interaction. |
| **DS-5** | `EmptyState` + `PageHeader` are the only house components in v1 | Build them per screen | §7 makes them mandatory on every list/data screen; defining them once keeps every screen consistent. |

**Necessary deviations from raw shadcn CLI output**, all forced by the rules above: the generated **dark-mode block is removed** (DS-3), the **palette values are replaced** with §3 (DS-1), and **animation durations are capped at ≤150ms** (DS-4). Everything else stays standard shadcn.
