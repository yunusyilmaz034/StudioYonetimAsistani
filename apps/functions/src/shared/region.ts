// Every function runs co-located with the `eur3` Firestore (Doc 1 §14). The SDK default is
// `us-central1`: without this, every trigger would cross the Atlantic to reach its own
// database — a latency cost, and an EU-residency posture we would rather not have to argue.
//
// It is declared on EACH function rather than relying on `setGlobalOptions` alone, because a
// trigger is defined when its module is EVALUATED — and ES imports are hoisted above the body
// of `index.ts`. A global set in that body arrives too late for the triggers imported at its
// top. Correctness must not depend on import order.
//
// A region is part of a deployed function's identity: changing it later creates a second
// function rather than moving the first. It is settable for free exactly once — before the
// first deploy.
export const REGION = 'europe-west1'
