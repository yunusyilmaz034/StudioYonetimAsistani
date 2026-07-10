// @studio/functions — Cloud Functions v2: the async work nobody is waiting for.
//
// Phase 1 will register exactly:
//   triggers/on-command-created   — the offline write path (Doc 3 §5)
//   triggers/on-event-created     — ONE trigger, two dispatch entries:
//                                   member.stats + memberSnapshot backfill (Doc 5 §4)
//   scheduled/auto-resolve-attendance  then  scheduled/expire-credits
//                                   (in that order — invariant I-19)
//
// None of it exists yet. This file is the deploy entrypoint and nothing more, so
// the scaffold typechecks without shipping a single trigger.
export {}
