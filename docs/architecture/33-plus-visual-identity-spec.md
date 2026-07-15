# 33 — Product Plus Visual Identity — **the spec (APPROVED)**

**Status: APPROVED (owner + Işıl, on real screens, 2026-07-15).** This is the design spec that Phase 1
(Doc 32 §1) implements against — the successor to Doc 20's palette. The *architecture* of Doc 09 (DS
v1) and Doc 20 (DS v2) stays; the **values** below replace the teal / cool-near-white ones.

**Visual reference:** [`docs/design/product-plus-vision.html`](../design/product-plus-vision.html)
(open it locally: `open docs/design/product-plus-vision.html`) — the rendered vision Işıl approved.

---

## 1. The concept — "Controlled Poise" (Kontrollü Zarafet)

Pilates teaches two things — **control** and **elongation** — and the interface expresses the same:
generous whitespace, fine alignment, and colour used with intent. The feeling is a well-lit reformer
studio at golden hour: **warm, alive, premium — but calm and controlled**, never clinical.

**Deliberately NOT** the AI-default "warm cream + terracotta + serif": the ground is a rose-grey warm
porcelain (not cream), the signature is a confident mulberry (not terracotta), and the serif appears
only on editorial moments (not everywhere).

Işıl's three complaints, and the answer each gets:
- *"Too white"* → cool grey-white ground → **warm porcelain**; pure-white cards → warm white a step up.
- *"Too colourless / lifeless"* → one confident **mulberry**, saved for brand/action moments; the rest
  carried by warm neutrals. Liveliness from **one** decisive hue, not from colouring everything.
- *"No premium feel / too flat"* → depth from **warm layered shadows** and surface tints, not borders;
  editorial **serif numerals** against clean sans — contrast is the antidote to flat.

---

## 2. Colour tokens — the exact values

Semantic tokens only; **no component carries a hex literal** (DS-1, lint-enforced). Light is primary;
dark is a real, warm second theme (also the "dark surface" treatment for hero moments).

### Light (primary)
| Token | Hex | Role |
|---|---|---|
| `--background` | `#F4EEEC` | warm porcelain ground (rose-grey undertone) |
| `--surface` (card) | `#FCF8F7` | a breath above the ground |
| `--surface-2` / muted | `#ECE1DD` | warm greige, recessed |
| `--foreground` (ink) | `#241C20` | warm plum-black — never a cool grey |
| `--muted-foreground` | `#6B5A5F` | warm mauve-grey |
| `--border` | `#E3D6D2` | warm hairline |
| `--primary` | `#A22D60` | mulberry / raspberry-plum — brand + action |
| `--primary-strong` | `#85234E` | hover / press |
| `--primary-tint` | `#F3E2E9` | selected / active surface (blush) |
| `--accent` (gold) | `#B5842F` | golden-hour honey — **premium highlights only, sparing** |
| `--accent-tint` | `#F2E8D6` | |
| `--on-primary` | `#FCF4F1` | text on primary |
| `--success` / tint | `#3E7A57` / `#E3EEE7` | active · paid |
| `--warning` / tint | `#A9761C` / `#F3E9D3` | low credits |
| `--danger` / tint | `#AC3A3A` / `#F5E0DD` | in debt |

### Dark (the warm second theme + hero "dark surface")
| Token | Hex |
|---|---|
| `--background` | `#1A1315` |
| `--surface` | `#241A1D` |
| `--surface-2` | `#2E2126` |
| `--foreground` | `#F3E9E9` |
| `--muted-foreground` | `#B39CA2` |
| `--border` | `#392A2F` |
| `--primary` | `#E27AA2` (lifted so it reads on dark) |
| `--primary-strong` | `#EC93B4` |
| `--primary-tint` | `#35202A` |
| `--accent` | `#D7A85A` |
| `--on-primary` | `#23151B` |
| `--success/warning/danger` | `#6FB388` / `#D6A85A` / `#E08585` |

**Semantic colour is a separate family from the accent.** Gold is a premium highlight, never a status;
warning stays ochre, distinct from gold.

---

## 3. Typography

- **Display / editorial** — a **humanist serif** (Palatino / Iowan family), used **only** for headings
  and **gauge numerals** (the "147 üye", the "12.400 ₺"). Light weight, tight leading. This is the
  premium/editorial signal, and keeping it to big moments is what stops it becoming the serif cliché.
  Stack: `"Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua", Georgia, serif`.
- **UI / body** — clean sans. The app already loads **Geist**; keep it (or the native system stack) for
  all interface text. Not Inter-as-safe-default.
- **Labels** — sans, uppercase, `letter-spacing: .14em`, small.
- **Data** — `font-variant-numeric: tabular-nums` wherever digits align.
- **Decision for implementation:** whether the display serif ships as a licensed webfont or rides the
  system stack is a Phase-1 build decision (a webfont is a load-cost + licence choice). The *direction*
  — serif display, sans UI — is fixed.

---

## 4. Depth, radius, spacing

- **Shadows are warm** — tinted with the plum ink, not black, and **layered** (two stops) for real
  depth. `--shadow-sm / -md / -lg` as in the vision file. Dark theme leans on surface elevation +
  border, not shadow.
- **Radius:** `--r-sm 8px · --r 12px · --r-lg 16px · --r-xl 24px`; status chips fully rounded. Modern
  soft-premium, not pill-everything.
- **Spacing:** generous vertical rhythm; cards breathe. Elongation over density — except where
  reception's speed needs density, and there the warmth lives in the chrome, not the data.

---

## 5. Components & roles

One shared component system; every staff screen draws from it (Doc 20). Treatments: buttons
(primary mulberry / ghost / quiet), warm-elevated cards, blush-focus form fields, status pills in the
semantic family, editorial gauge cards with an area-fill sparkline (emphasised endpoint), warm-shadow
dialogs. Roles share the language, differ in rhythm: **Owner** — calm command, editorial numbers, air;
**Reception** — warm but fast, keyboard-first, dense data in warm chrome; **Trainer** — focused,
minimal, one screen (names only, no PII beyond them).

---

## 6. What does not change

- **Business logic, events, behaviour, flow, click-count** — untouched. Pure presentation (Doc 31 §4).
- **DS-1** stays lint-enforced: values live in `globals.css` + shared components; business screens do
  not change to be restyled. If one must, it was hiding a hex literal — fix the violation.
- **Operation speed** is the one Alpha rule that survives intact (Doc 20 §1.1).
- Işıl approves the final palette **on real screens** — the vision is approved; the built screens are
  validated the same way, because the last palette was rejected in use.

**Related:** Doc 31 (the brief) · Doc 32 §1 (the phase) · Doc 20 / Doc 09 (the architecture this fills)
· `docs/design/product-plus-vision.html` (the approved visual).
