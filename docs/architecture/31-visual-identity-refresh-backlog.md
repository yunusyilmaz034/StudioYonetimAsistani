# 31 — Visual Identity Refresh (Product Plus, first phase) — **architecture backlog**

**Status:** backlog — accepted onto the Product Plus roadmap (owner, 2026-07-15). **No code yet.**
This is a **design brief**, not an implementation. It is Product Plus's **first major work item, to be
done BEFORE any new feature** — the same discipline Doc 20 used: features pause, the whole surface is
restyled at once, on one system.

> **The trigger is real-user feedback, and that is why it outranks a preference.** Işıl — the person
> who runs the studio on this product every day — finds the current look tiring and corporate, not
> premium. The daily user's verdict on the daily surface is the most authoritative signal a product
> gets, and it is worth more than any internal opinion about the palette.

---

## 1. The binding constraint

> **This is a re-tokening and a component-treatment pass, NOT a re-architecture and NOT a colour
> swap. The design-system ARCHITECTURE (Doc 09 DS v1, Doc 20 DS v2) stays; its VALUES and its visual
> treatment change — everywhere, once, together.**

Two failures this milestone must not commit:
- **A colour swap that stops at the palette.** The owner was explicit: not just new colours — a new
  visual identity. A refresh that only retunes `--primary` and ships is the thing she is rejecting.
- **A per-screen restyle that drifts.** The whole point of Doc 20 was one language across every
  screen. Touching screens one at a time re-introduces the drift that milestone removed. It is done
  as a system, or it is not done.

---

## 2. Why this is CHEAP to do right — the seam was built for it

The redesign does not touch business screens one by one, because it was built so it would never have
to. This is the test of whether Doc 09 / Doc 20 were built right, and they were:

| The refresh needs | What the system already guarantees |
|---|---|
| Change every screen's colours at once | **DS-1: components use semantic tokens, never a hex literal.** `bg-background`, `text-muted-foreground`, `--primary` — retune the token, every screen moves together. |
| One look across owner · reception · trainer | Doc 20 already put **every staff screen on one shared component system.** There is one place to change a card, a button, a table. |
| A premium feel without a rewrite | Shadows, radius, spacing, type scale are already **tokens** (`--shadow-md`, `--text-display`, …), not per-component magic numbers. |
| Stay light-first | The system is **already light-only and tuned** (Doc 20 §10). Dark mode was never shipped, so deferring it costs nothing. |

**So the work is concentrated, not spread:** the palette and treatment live in `globals.css` and the
shared components, and the discipline that keeps hex out of screens (DS-1, lint-enforced) is exactly
what makes a studio-wide restyle a bounded change rather than a thousand-file sweep.

---

## 3. The brief (owner direction — the exact palette is designed WITH Işıl, not guessed)

Işıl rejected the current identity; the person who rejected it is the person who signs off the
replacement. So this records the DIRECTION and the CONSTRAINTS, and leaves the specific values to be
designed and approved with her — the same way the catalogue's prices are her decision, not the code's.

**What she said, and what it maps to:**

| Feedback | Direction |
|---|---|
| "Beyaz arka plan göz yoruyor" | Current `--background: #f7f8fa` is a **cool** near-white. Move to a **softer, warmer** base — an off-white/warm-neutral, not pure `#ffffff` on cards either. |
| "Turkuaz cansız, kurumsal" | Current `--primary: #0f9f96` (teal). A **livelier, warmer, more premium** primary — chosen with her, against the boutique-women's-pilates identity, not a corporate SaaS teal. |
| "Fazla düz ve renksiz" | More depth: **premium shadows, considered radius, generous spacing**, richer surface hierarchy — within the token system, not ornament for its own sake (Doc 20 §1.2 still holds: restraint over effects). |
| "Premium, modern, canlı" · "kadınlara hitap eden butik" · "ilk açılışta premium algı" | A deliberate **visual identity** — palette + type + spacing + imagery treatment — that reads as premium boutique from the first screen, before a single click. |

**Non-negotiable that survives from Doc 20:** operation speed. The redesign must not cost a tap or a
click. A prettier screen that is slower to work is a regression, and reception feels it every day
(Doc 20 §1.1).

**Scope:** owner, reception, and trainer screens — all on the one language. The member portal
(Doc 21) shares the token base and should follow, but the staff surface is the priority.

**Light-mode first; dark mode deferred** (owner) — and cheap to defer, because the system is already
light-only.

---

## 4. The shape the work must take (so it is not built wrong)

- **Values move in `globals.css` and the shared components; screens do not change.** If a business
  screen has to be edited to restyle it, that screen was carrying a hex literal it should not have —
  fix the violation, do not thread colour through it. DS-1 stays lint-enforced.
- **One PR-sized language, reviewed as a whole**, in batches like Doc 20 §12 — not a screen at a time.
- **Işıl approves the palette on real screens**, not a swatch. She rejected the last one in use; the
  next one is validated the same way.
- **No feature, domain, event, or behaviour changes** — this is Doc 20's rule, and it is what keeps a
  visual milestone from smuggling in scope. Pure presentation.
- **Product Plus, `feature/product-plus`.** `main` stays frozen (hotfix/production only). This does
  not touch the pilot's running build until Plus merges.

---

## 5. Relationship to the existing design docs

This is **Design System v3** — it *evolves* Doc 20's architecture (the token system, the one shared
component system, light-first), and it *supersedes* Doc 20's specific palette decisions (teal,
cool near-white), which shipped 2026-07-12 and which the daily user has now rejected in practice. The
component ARCHITECTURE was right — it is what makes this affordable. The VALUES it was filled with are
what change.

**Related:** [`09-design-system.md`](09-design-system.md) (DS v1 — tokens, the no-hex rule) ·
[`20-premium-design-system.md`](20-premium-design-system.md) (DS v2 — the shared component system this
restyles) · [`21-member-portal.md`](21-member-portal.md) (shares the token base; follows). Nothing is
scheduled here; it is the brief, sequenced when the owner opens Product Plus.
