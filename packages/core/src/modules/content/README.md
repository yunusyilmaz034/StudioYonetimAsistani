# content — the studio's Instagram plan (IG-2a)

**Purpose.** Each week the studio gets 3–5 post suggestions (AI) or adds its own: a shot card (what to
film, how, for how long), an on-screen hook, a caption and hashtags. The owner approves. Nothing in this
module publishes — publishing is IG-2b and will be gated on `content_post.approved`.

**Public API** (`index.ts`): `planContentPosts`, `editContentPost`, `approveContentPost`,
`removeContentPost`, the pure `decide*` functions, `istanbulWeekStart`, `CONTENT_LIMITS`,
`FirestoreContentRepository`.

**State.** `studios/{sid}/contentPosts/{cnt_…}` — server-only.

**Events.** `content_post.planned | edited | approved | removed` (v1, golden fixtures). No free text
(title, caption, shot card) ever enters an event (#6, by policy).

## Invariants this module owns

1. **Only the owner (or platform_admin) approves** (OR-131). A receptionist or trainer may plan and edit.
2. **An edit after approval withdraws the approval** (`approvalWithdrawn: true`): the owner approved that
   text, not this one.
3. **Instagram's limits are refused at writing time:** caption ≤ 2.200, hashtags ≤ 30 (deduplicated,
   Turkish-aware), clips 1–8 of 1–60 s, title ≤ 120, hook ≤ 120.
4. **No post is planned or approved into the past.**
5. **A removed post is history** — not edited, not approved back.
6. **Consent is recorded with the approval** (`consentConfirmed`), never who was visible.
