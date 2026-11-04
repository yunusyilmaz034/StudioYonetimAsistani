# ads — paid ad campaigns (IG-5a)

**Purpose.** The AI (or the studio) drafts a campaign; the OWNER approves; only then is it published to
Meta. MONEY — the rules below are the owner's (OR-131, 2026-11-04) and each has a test in `domain/decide.test.ts`.

**State.** `studios/{sid}/adCampaigns/{adc_…}` (server-only). Caps: `settings/ads.dailyCapKurus` /
`campaignCapKurus` — data, not constants. No caps set ⇒ nothing can be proposed.

**Events (v1, golden):** `ad_campaign.proposed | edited | approved | publish_started | published |
publish_failed | removed`. Money facts and Meta ids only — no ad copy, no rationale, no Meta error text.

## Invariants this module owns

1. **Nothing reaches Meta without `ad_campaign.approved`.** `decideStartPublishing` accepts only `approved`.
2. **One approval, one campaign.** `publishing` is a lock taken in a Firestore transaction together with
   the approval; a second press finds it taken and is refused.
3. **Caps are refused, never clamped:** daily budget ≤ daily cap; daily × days ≤ campaign cap. Exactly the
   cap passes; one kuruş or one day over does not. The AI is held to the same rule.
4. **An end date is mandatory**, at most 90 days, start today or later. No campaign spends forever.
5. **Only owner / platform_admin approve.** Approval re-judges the draft against TODAY's date and the
   CURRENT caps, and stamps those caps on the event (#4).
6. **A failed publish spends the approval** — it is fixed and approved again, never retried silently.
7. **Money is integer kuruş** (#10) — Meta receives the same integer (TRY's minor unit).

## IG-5b — changes to a campaign on Meta (`domain/changes.ts`)

Events (v1, golden): `ad_campaign.change_requested | change_applied | change_failed | change_dismissed`.

8. **The owner's press is the approval** (one confirm); the AI only **asks** — one pending request per
   campaign, stored as `pendingChange`, never applied by itself.
9. **Same caps, strict rule:** new daily ≤ daily cap; new daily × ALL the campaign's days ≤ campaign cap;
   ≤ 90 days. A request over the cap never exists. Pause needs no cap — it only stops spending.
10. **`change_applied` only after Meta accepted**, re-decided at commit, stamping origin and caps. Meta
    refused → `change_failed`, previous state kept, a pending request is spent.
11. **No persisted lock:** every Meta write is an absolute value (status / daily_budget / end_time), so a
    repeat is harmless. If Meta accepted but the commit is refused, the nightly drift check shows it.
