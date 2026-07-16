// The insights module's only public door (Plus Phase 10 — AI Insights L1). A PURE, deterministic
// advisor over facts the studio already records. No event, no aggregate, no PII, and it NEVER acts —
// it ranks what needs attention and suggests the tool (see README).
export type {
  BalanceFact,
  EmptySessionFact,
  ExpiringFact,
  Insight,
  InsightAction,
  InsightConfig,
  InsightFacts,
  InsightKind,
  InsightSeverity,
  InsightSource,
  InsightSubject,
  InsightSubjectType,
  LowCreditFact,
} from './domain/types'
export {
  DEFAULT_INSIGHT_CONFIG,
  deriveInsights,
  mergeInsightSources,
  rankInsights,
  ruleInsightSource,
} from './domain/rules'
