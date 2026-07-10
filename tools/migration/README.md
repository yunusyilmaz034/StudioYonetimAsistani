# tools/migration

A **script folder — never a package, never deployed, never in CI** (AD-36).

The incumbent-platform import is run **by hand**, with Admin credentials, for a
one-time cutover (Doc 1 §16, Doc 3 §12, Doc 8 §5–§7). A migration that can run
automatically is a migration that will, once, at the wrong moment.

## Shape (built in the migration milestone, not now)

```
CSV/Excel export ──▶ [adapter]    incumbent-specific: parse, coerce, map ids
                        ▼
                   canonical DTOs
                        ▼
                   [validator]    fail loudly, never guess
                        │            · phones → E.164; invalid/colliding rows BLOCK the run (AD-40)
                        │            · products imported, never hardcoded (AD-41)
                        ▼
                   [importer]     emits real domain events, actor: {type:'migration'},
                        │            historical occurredAt; unmarked attendance → system_default (AD-38)
                        ▼
                   Firestore (state + events)
                        ▼
                   [reconciler]   assert every active entitlement's remaining
                                  credits vs. the source; a human signs off
```

The root scripts `migrate:validate`, `migrate:dry-run`, and `migrate:reconcile`
point here. Their target files do not exist yet — they arrive with the migration
milestone. Nothing in this folder is imported by `apps/` or `packages/`.
