# 12 — Product UX Principles

> **Status: approved, binding, product-level.** These are permanent product decisions, not per-milestone choices. Every business module — present and future — is built to them. They extend, and are consistent with, the Design System (Doc 09) and are enforced as a default working rule by the Development Workflow (Doc 10 §6).

These principles answer one question the same way every time: **what does good look like for the owner running the studio?** They sit above any single screen. Where a principle names concrete UI (tabs, Sheet, agenda), that UI is the Design System's job to deliver (Doc 09 §8 templates); the principle is the law the template obeys.

The list is a small set on purpose. When a screen seems to need a pattern none of these cover, that is a design question to raise with the owner — not to improvise.

---

## UX-1 · Single Workspace Principle

A business object — **Member, Reservation, Staff, Service, Room, Package, Subscription, …** — is managed inside **one workspace**.

- The user never travels between separate pages to manage one object.
- All related information for the object is shown in that one workspace, organised with **tabs / sections / accordions / Sheets**.
- **Desktop** uses tabs; **mobile** uses sections / accordions / full-screen Sheets. The **capability is identical** at both sizes — only the presentation differs.
- Every edit made inside the workspace **still emits its event**. The UI never bypasses the command → decision → event log. The workspace is a presentation of state, not a shortcut around it.

*This is the governing UX law. Recorded also as Design System decision **DS-8** (Doc 09 §7, §13).*

---

## UX-2 · Mobile-First Operations

- Owner and Reception must be able to run the product **fully from a phone**.
- Mobile is **never a "lite" version.** No capability is removed on mobile.
- The same capability is presented with different UI at different sizes.
- **375px is the reference resolution.** A workflow that is not complete at 375px is not done.

*Consistent with Doc 09 §9 (Mobile-First mandate) and DS-6.*

---

## UX-3 · Scheduling UX Principle

- **Desktop** default view is the **Month Calendar**.
- **Mobile** default view is the **Agenda / List**.
- Opening an event **never uses a popup.** Desktop opens a **right Sheet**; mobile opens a **full-screen Sheet**.
- Before an event card is opened, the following are already visible on it: **service, time, trainer, occupancy, and status.**
- The owner manages the daily operation **without leaving the calendar.**

*Refines Doc 09 §8 template 5 (Calendar / schedule). Binding on the Scheduling and Reservation modules.*

---

## UX-4 · Information Density

- The owner must be able to **decide at a glance.**
- Information is **organised, never hidden.**
- Priority is **readable information density** — meaningful information in place of empty space.
- Whitespace serves reading; it is not a substitute for the information the owner needs.

*This tightens, and is bounded by, the accessibility rules in Doc 09 §7 (status never by colour alone; the four mandatory data states). Dense is not cramped.*

---

## UX-5 · Inline Editing

- **Every field that can be edited in place, is.**
- A separate edit screen is the **last resort**, not the default.
- Every change **produces an audit / event.** Inline editing changes where you edit, never whether the log is written.

*A direct consequence of UX-1: if the object lives in one workspace, its fields are edited there.*

---

## UX-6 · No Dead Ends

- From wherever the user is, the **full detail of a related object is reachable in one move.**
- A popup or modal must **never trap the user** in a dead end. A modal is only a confirmation or a short focused task (Doc 09 §7); it is never how you reach an object's own data.

---

## UX-7 · Responsive Consistency

- Responsive means **changing the presentation, not reducing capability.**
- Desktop and mobile offer the **same functions.**
- One adapting primitive beats two parallel builds (DS-7).

---

## UX-8 · Owner First

- The priority is the **business owner**, not the end customer.
- The core UX goal is that the owner runs the **daily operation with the fewest clicks.**
- Frequently-used actions are **completed inside a single workspace** (UX-1).

*This is the product vision expressed as UX: the owner opens the product and immediately knows — and can act on — what needs attention today.*

---

## UX-9 · Attendance Speed — Fewest Taps

The Attendance Workspace is judged, above all, on **how fast reception clears a
roster.** The target is explicit: it must be **faster than the tools reception already
uses** (the incumbent, e.g. BulutGym). On a phone at a busy hour, an owner or
receptionist must resolve **dozens of members with the fewest possible taps.**

- **One tap = attended.** The policy default outcome (this studio: `attended`) is a
  single tap on the member row.
- **The second action = no-show.** One deliberate step away, never buried.
- **Correction is always a separate flow, with a mandatory reason.** It never shares
  the one-tap affordance — overturning a resolved outcome is a distinct, audited act
  (AD-22), never a slip of the thumb.
- **Bulk is always faster than single.** "Resolve everyone remaining" must cost fewer
  taps than marking each; the workspace always offers the bulk path.
- **The user finishes without leaving the workspace** (UX-1, UX-6).

*Permitted, not mandated* — future design may reach the target through **swipe
gestures** (right = attended, left = no-show) or a **long-press / overflow menu** for
correction. These are *means* to the fewest-taps end, chosen when the workspace is
designed. **The goal is binding; the specific gesture is not.**

*This is UX-8 (Owner First) sharpened for the highest-frequency reception task. It is
a design goal for the Attendance Workspace (v1.11+), not a per-screen rule — and it
never trades away the audit trail: every mark and every correction still emits its
event (see below).*

---

## How these bind

| Principle | Enforced through |
|---|---|
| UX-1 Single Workspace | Doc 09 §7 + **DS-8**; Doc 10 §6 |
| UX-2 Mobile-First | Doc 09 §9 + **DS-6**; verified at 375 / 430 / 768 / 1280 |
| UX-3 Scheduling | Doc 09 §8 template 5; Scheduling (Doc 11) & Reservation modules |
| UX-4 Information Density | Doc 09 §7 (bounded by accessibility + four data states) |
| UX-5 Inline Editing | UX-1; the command → event path is unchanged |
| UX-6 No Dead Ends | Doc 09 §7 (drawer/modal rule) |
| UX-7 Responsive Consistency | Doc 09 §9 + **DS-7** |
| UX-8 Owner First | Product vision (Doc 01, CLAUDE.md) |
| UX-9 Attendance Speed | Attendance Workspace design goal (v1.11+); one-tap attended, bulk-first, correction always separate |

**None of these principles ever justifies bypassing the event log.** Correctness and the audit trail outrank UX convenience — a workspace, an inline edit, or a denser screen that skipped an event is a defect, not a nicer UX.
