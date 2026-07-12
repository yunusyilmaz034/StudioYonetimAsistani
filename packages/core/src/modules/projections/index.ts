// The projections module (v1.23). The FIRST projection in the system, and the only one: the daily
// read model behind the owner dashboard and the analytics charts.
//
// Two properties make it safe to have at all, and both are enforced here rather than trusted:
//   • it folds EVENTS ONLY — never a state document (a projector that reads state cannot be rebuilt);
//   • it is a pure fold, so `pnpm projections:rebuild` reproduces it exactly. Projections are
//     disposable: if this is ever wrong, delete it and replay the log.
export {
  applyIncrement,
  emptyDaily,
  projectDaily,
  EMPTY_COUNTERS,
  type DailyCounters,
  type DailyIncrement,
  type DailyReadModel,
  type ProjectableEvent,
} from './domain/daily'
export type { ProjectionRepository } from './application/ports'
export { FirestoreProjectionRepository } from './infrastructure/repos'
