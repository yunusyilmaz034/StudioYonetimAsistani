# insights — AI Insights L1 (Plus Phase 10)

**Purpose.** Turn the facts the studio already records into a ranked "what needs attention today" list
— each insight naming a concrete next step that deep-links to an existing tool. This is the product
vision's decision-support layer: the owner opens it and immediately knows what to do.

## The invariants this module owns

> **1. It never acts.** An insight is a SUGGESTION. Every `suggestedAction` maps to a tool the human
> already has (offer a renewal, collect a balance, fill a class); the advisor performs none of them.
> A human decides — always (roadmap §10; owner rule: "öneri üretir, insan onayı şart, asla oto-aksiyon").

> **2. L1 is deterministic and pure.** The rule source is `(facts, config) → ranked Insight[]`, with no
> clock, no I/O, no randomness — so it is exhaustively testable. That is *why* L1 is rules and not an
> LLM: a non-deterministic decision function cannot be tested, and a decision-support product must be
> trustworthy before it is clever.

> **3. It is PII-free and event-free.** An insight carries opaque ids + numbers, never a name (#6); the
> web layer resolves names for display. Insights are DERIVED on read — no event, no aggregate — and
> **self-clear** when the owner acts on the underlying fact (renew → not expiring; collect → no balance).

## The L2 seam (built, not used)

`InsightSource { id, generate(facts, config) }` is the extension point. L1 ships one source,
`ruleInsightSource()`. A future L2 LLM narrator implements the SAME interface and is merged via
`mergeInsightSources([...])` — no reshaping of the consumer. The event log was built for exactly this
(roadmap §10): the LLM's trustworthiness is a function of every phase above keeping the event discipline
— no presumption written as an observation (#11), no PII in the log (#6).

## Public API

- `deriveInsights(facts, config)` / `ruleInsightSource()` — the L1 rule source.
- `mergeInsightSources(sources, facts, config)` — merge + rank + de-dup (the seam).
- `DEFAULT_INSIGHT_CONFIG` — the seed thresholds (data; a studio may tune them later).

The web maps the owner dashboard (a 1-read bounded query) into `InsightFacts` and renders the ranked
list with resolved names + deep links. Nothing here imports firebase-admin.
