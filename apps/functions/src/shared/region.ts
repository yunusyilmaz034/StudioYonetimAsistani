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

// ── E-POSTA (2026-07-14, production) ─────────────────────────────────────────────────────────
//
// A Cloud Function v2 does not see a Secret Manager secret unless it ASKS for it. We had put
// `RESEND_API_KEY` in `apphosting.yaml` — the WEB tier — which never reads it. The functions read it,
// and had it declared nowhere. So `process.env.RESEND_API_KEY` was `undefined`, the provider fell
// back to the console, and every e-mail the studio believed it had sent was written to a log and
// thrown away. Silently. The code even warned about it, in a comment we wrote and then walked past.
//
// `EMAIL_FROM` is NOT a secret — it is the identity the domain's SPF/DKIM records authorise, and it
// belongs beside the key rather than inside it.
export const EMAIL_SECRETS = ['RESEND_API_KEY'] as const
