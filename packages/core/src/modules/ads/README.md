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
