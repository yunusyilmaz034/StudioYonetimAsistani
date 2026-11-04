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

## IG-2b — publishing (`domain/publish.ts`, 2026-11-04)

Events (v1, golden): `content_post.media_attached | publish_approved | publish_started | published | publish_failed`.

- Anyone on the content screen attaches the file; **only the owner approves publishing**, with the KVKK
  consent ticked and a file that fits Instagram's limits (`mediaFits`, refused at upload).
- `scheduled` → at `publishAt` (planned time, or now) the publisher (functions, every 5 min) takes the
  **lock** (`publish_started`, a transaction — Instagram publishing is not idempotent) → published | failed.
- A new file or an edited caption after approval **withdraws it**. A failure spends the approval.
- A run that died after the lock is marked failed after 20 min ("durum belirsiz — Instagram'da kontrol et").
- Files: private Storage `studios/{sid}/content/{postId}/…`; Meta reads them through a download token
  that exists only while publishing; deleted 90 days after publishing.
