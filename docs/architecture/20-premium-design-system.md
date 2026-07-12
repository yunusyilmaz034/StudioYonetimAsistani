# 20 — Premium Design System & Owner UI Redesign · Design (v1.20)

> **Status: SHIPPED (owner-approved, 2026-07-12). Foundational decisions §10 resolved —
> light-only (perfected), keep Geist, keep teal (retuned/sparing), comfortable density with
> a later compact toggle. Built and reviewed in nine batches (§12); every owner screen now
> draws from one component system. No feature, domain, event or behaviour changed.**
>
> A dedicated milestone: **feature development pauses** and the **entire Owner UI is
> redesigned at once** on **one professional Design System** — a single design language,
> one shared component system, across every owner screen. This is **Design System v2**,
> evolving Doc 09 (DS v1), not replacing its architecture.
>
> **Goal:** from the first open, a product that inspires trust and looks more professional
> than any competitor — while staying **as fast to operate as the old system**.

Quality bars (owner): **Apple** simplicity · **Linear** clean, ordered layout · **Stripe
Dashboard** enterprise professionalism · **Notion** readable typography · operation speed
of the old system.

---

## 1. Binding principles (owner directive)

1. **Operation first, aesthetics second.** The UI must make work **faster (fewer clicks)**,
   never slower. Nothing decorative may cost a tap.
2. **No gratuitous visual effects.** Restraint over ornament.
3. **Generous whitespace, balanced alignment, quality typography.**
4. **One design language per screen; the SAME across all owner screens.**
5. **One shared component system** — every owner screen is built from it.
6. **Premium SaaS feel.**
7. **Easy on the eyes for 8–10 h/day** use — low glare, calm contrast, no vibration.
8. **Responsive from day one** (375 · 430 · 768 · 1280).

These extend the Product UX Principles (UX-1…UX-9) and the Design System decisions
(DS-1…DS-8); nothing here weakens Single Workspace (DS-8) or Mobile-First (DS-6).

## 2. What this milestone is — and is NOT

- **IS:** a visual + interaction-quality pass. Tokens, typography, spacing, component
  styling, layout language, app shell, states (hover/focus/empty/loading), density, and
  consistency — applied to **every existing owner screen**.
- **IS NOT:** new features, new domain, new events, or behavior changes. Screens keep
  their current data and actions; only their **presentation and interaction quality**
  change. The member portal (v1.21) is out — it will be built on this system.

## 3. Relationship to DS v1 (Doc 09)

Kept: semantic CSS-variable tokens (DS-1), shadcn + base-ui via tokens (DS-2), motion
discipline (DS-4), PageHeader/EmptyState house components (DS-5), mobile-first
composition (DS-6/7), Single Workspace (DS-8). **Evolved:** the palette is retuned, a full
**type scale** and **spacing rhythm** are introduced, **elevation** is systematized, the
**app shell** (v1.19 nav) is elevated, and the component set is expanded and made
consistent. DS-3 (no dark mode) is **re-opened as a decision** (§10-A).

## 4. Design tokens v2 (the foundation, built first)

- **Neutrals:** a refined, slightly cool gray ramp (Linear/Stripe register) — calm
  backgrounds, clear but soft borders, text at accessible contrast (not pure black on
  pure white — easier on the eyes for all-day use).
- **Brand:** the teal (`#0f9f96`) is retained by default (§10-C) but retuned for balance;
  used sparingly (primary actions, active nav, focus) — Stripe-like restraint, not a
  colored UI.
- **Status:** success/warning/danger/info kept, harmonized to the neutral ramp.
- **Typography:** a deliberate scale — display / h1 / h2 / h3 / body / small / caption with
  defined size · weight · line-height · letter-spacing (Notion-readable: comfortable
  line-height, tight but not cramped tracking). Base stays operational (≈14px) for
  density; headings gain hierarchy. Font decision in §10-B.
- **Spacing:** an **8pt rhythm** with a small set of gutters; generous section spacing;
  consistent page padding and max content widths per screen type.
- **Radius & elevation:** one radius scale (control/card/overlay); elevation via **subtle
  border + soft shadow**, never heavy drop-shadows. Overlays (Sheet/Dialog) get a refined
  scrim + elevation.
- **Motion:** unchanged discipline — ≤150ms, purposeful (overlays, state changes), never
  decorative (DS-4).

## 5. Component system (one set, every screen)

Audit and elevate the shared primitives so every screen draws from the same, consistent
set — nothing bespoke per screen:

- **Core:** Button (variants/sizes/states), Input, Select, Textarea, Checkbox, Badge,
  Card, Table, Dialog, Sheet, Toaster, EmptyState, PageHeader.
- **Patterns introduced/standardized:** a house **Tabs** (Session Workspace, Member
  Workspace), the **calendar chips/rows** (both calendars), the **app shell / nav rail**,
  the **filter bar**, list ↔ table responsive pattern, the **stat/metric** block
  (dashboard), the **section header**, and consistent **hover/focus/active/disabled/empty/
  loading** states across all of them.
- Every component references tokens only (DS-1); no hex, no per-screen overrides.

## 6. App shell & layout language

- **Nav rail** (v1.19) elevated to premium: clear brand lockup, calm active state, refined
  spacing, quiet iconography; mobile bottom bar refined for thumb reach and legibility.
- **Page structure:** a consistent header (title · context · primary action), a calm
  content column with generous gutters, and predictable density. Dashboard, list, and
  workspace screens each get a defined, repeatable anatomy.

## 7. Screens redesigned (all owner surfaces, same system)

Genel Görünüm (dashboard) · Üyeler (list) · Member Workspace · Ders Ajandası · Rezervasyon
Ajandası · Session Workspace · Check-in · Yoklama · Paketler · Login. Each is re-skinned to
the system with **no behavior change**; the calendars' dense cells and the workspaces'
tabs are made premium yet fast. The v1.19 review nit — **Member Workspace repeated
top-actions** (quick-action bar vs. in-tab actions) — is resolved here as part of the
consistency pass.

## 8. Approach & sequencing (feature freeze)

1. **Foundation first:** tokens (color/type/spacing/elevation) + the component system, on
   the `/design-system` showcase — reviewed before any screen changes.
2. **Screen-by-screen application** in review batches (e.g. shell+dashboard → lists →
   workspaces → calendars → operational screens), each a checkpoint.
3. No feature work lands during v1.20. `pnpm check` + `next build` green at every step;
   responsive at the four breakpoints; every screen keeps its data and actions.

## 9. Out of scope

New features/domain/events · behavior changes · member portal (v1.21) · Payments (v1.22)
· the Functions/attendance fix (DEBT-011, v1.24). Purely a presentation + interaction
-quality milestone.

## 10. Foundational decisions — RESOLVED (owner, 2026-07-12)

- **A — Dark mode → A1: light only, perfected.** One theme, done impeccably; dark can
  follow later (tokens stay role-based so it remains addable without a rewrite). DS-3
  stands for now.
- **B — Typeface → B1: keep Geist.** Self-hosted; clean/modern, close to the Linear
  register. Zero migration risk; the type *scale* (sizes/weights/line-height/tracking) is
  what gets designed.
- **C — Brand color → C1: keep the teal (`#0f9f96`), retuned + used sparingly.** Brand
  continuity; a mostly-neutral UI with the accent reserved for primary actions, active
  nav, and focus (Stripe-like restraint).
- **D — Density → comfortable baseline + a later compact toggle.** Comfortable, calm,
  mobile-friendly by default; the **calendars stay information-dense** (operations demand
  it); a user-selectable compact mode is a later addition, designed for but not built now
  (an extension point, not this milestone's feature).

## 11. Validation & risks

- Foundation reviewed on `/design-system` before screens change; each screen batch is a
  checkpoint; `pnpm check` + `next build` green throughout; responsive at 375·430·768·1280.
- **Risk — scope:** redesigning every screen is large; the batched sequencing (§8) keeps it
  reviewable and reversible.
- **Risk — regressions:** no behavior/data changes; visual-only diffs, screen by screen.
- **No feature or domain change ships in v1.20.**

## 12. What shipped — the nine batches (owner-reviewed, in order)

0. **Foundation** — type scale (display/h1/h2/h3), elevation scale, retuned tokens, the
   `/design-system` showcase.
1. **App Shell** — nav rail + mobile bottom bar elevated; calm active state.
2. **Dashboard** — nine equal-weight widgets became four zones in the order the owner acts:
   *Hızlı işlem → Şimdi → Bugün → Dikkat gerektirenler → Son hareketler*. The class list and
   the PT list rendered the same private sessions twice (`todayPt ⊂ todaySessions`) — now ONE
   chronological programme with a PT tag, and the two metrics no longer overlap (owner call).
3. **Class Calendar** — three strips of chrome became one control panel; a range summary
   scoped to the days actually on screen (the query loads a month); month cells given room;
   a day's rows on one card instead of one card per row.
4. **Reservation Calendar** — same language; member names kept dense in month cells.
5. **Session Workspace** — the header now answers *when · who · where · how full* on every
   tab; house `Tabs`; the destructive action separated from routine edits.
6. **Attendance** — the day's totals lead (**Bekleyen** is the screen's whole question);
   list on one surface.
7. **Members** — list on one surface; **deliberately no metric strip** (a total that changes
   no decision would only cost space — §1).
8. **Member Workspace** — the repeated top-actions nit (§7) resolved: "Paket"/"QR" quick
   actions removed (they duplicated the tabs one row below), and the in-tab "Düzenle" /
   "Hızlı Rezervasyon" duplicates dropped. Member stats moved to a header strip so a
   **balance owed is visible on open** (UX-8).
9. **Packages** — the price list right-aligned and tabular so a column of prices is scanned,
   not read.

**One state language across every screen:** hover = soft teal; today = filled teal chip; the
focused date = the same shape one step quieter; **normal is quiet, abnormal is loud** (an
active member/product reads as a caption, a passive one gets a badge).

### Defects found and fixed on the way (presentation-layer, not behaviour)

- **`Select` rendered raw values.** `base-ui`'s `Select.Value` prints the *value* unless it
  is given an item map or a render function — so filters showed the internal `all` sentinel
  and the Session Workspace's trainer/room pickers showed **raw ids** (`__none__`, a staff
  id). Both now resolve to labels.
- **Stale copy** — the Payments seam still announced "Payments v1.19"; it is v1.22.
- **`next-env.d.ts`** (Next-generated, "should not be edited") is now eslint-ignored: Next
  15.5 writes a triple-slash reference into it that our own lint rule forbids, which broke
  `pnpm check` on a file nobody authors.
- **DEBT-012** recorded: a stale session cookie causes an infinite redirect loop (the
  middleware is a coarse gate by design and cannot see that a cookie is invalid). Not fixed
  here — that is a behaviour change, and v1.20 ships none. Repay before the v1.23 cutover.
