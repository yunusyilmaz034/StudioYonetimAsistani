import type { DomainError, Result, TenantContext } from '@studio/core'

// The web tier's structured log (Doc 6 §9). Until v1.26 there was none: every Server Action —
// booking, collection, credit adjustment, refund — ran and returned in total silence. The path the
// money travels was the least observable in the system.
//
// ── Why there is no logging library here ────────────────────────────────────────────────────
// App Hosting runs on Cloud Run, where **a JSON object on stdout IS a structured log entry**:
// Cloud Logging parses `severity` and promotes the rest to `jsonPayload`. A library would buy
// transports we do not have and a dependency we would have to keep. What is needed is not a
// package; it is a discipline, and a discipline needs exactly one door.
//
// ── The three fields that are never optional ────────────────────────────────────────────────
// `correlationId` · `studioId` · `actor.type`. The first is the OperationId (OP-2): one act, one
// id, every consequence — the same id the Activity Center reads. A log line you cannot join back
// to the operation that produced it is a line you will read once, during an incident, and learn
// nothing from.
//
// ── PII never enters a log ──────────────────────────────────────────────────────────────────
// The same rule as the event payloads (#6), for the same reason: logs are exported, aggregated,
// and read by people who have no business knowing a member's phone number. An opaque `memberId`
// is fine — it identifies a row to us and nobody to anyone else. A name is not. There is no
// technical guard here, because a guard that scans strings for names would be theatre; there is a
// rule, and it is the reviewer's job.
//
//   log.info('reservation.booked', { memberId, classSessionId })   ✅
//   log.info('reservation.booked', { memberName })                 ❌ never

type Severity = 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR'

/** Fields safe to log: opaque ids, codes, counts, booleans. Never a name, phone, e-mail or note. */
export type LogFields = Record<string, string | number | boolean | null | undefined>

interface Entry extends LogFields {
  severity: Severity
  message: string
  correlationId?: string
  studioId?: string
  actorType?: string
  actorId?: string
}

function emit(severity: Severity, message: string, fields: LogFields = {}): void {
  const entry: Entry = { severity, message, ...fields }
  // One line, one JSON object. Cloud Run gives it to Cloud Logging; a developer reading `pnpm dev`
  // gets something they can still read.
  process.stdout.write(`${JSON.stringify(entry)}\n`)
}

/** Bind the fields every line must carry, so no call site can forget them. */
export function logFor(ctx: TenantContext, correlationId?: string) {
  const base: LogFields = {
    studioId: ctx.studioId,
    actorType: ctx.actor.type,
    actorId: ctx.actor.id,
    ...(correlationId ? { correlationId } : {}),
  }
  return {
    info: (message: string, fields?: LogFields) => emit('INFO', message, { ...base, ...fields }),
    warn: (message: string, fields?: LogFields) => emit('WARNING', message, { ...base, ...fields }),
    error: (message: string, fields?: LogFields) => emit('ERROR', message, { ...base, ...fields }),

    /** A DOMAIN REFUSAL — the system worked, and said no. It writes no event, so if it is not
     *  logged it did not happen. "Why can't I book her in?" is answered from these lines. */
    refused: (action: string, code: string, fields?: LogFields) =>
      emit('WARNING', `${action} refused`, { ...base, ...fields, refusalCode: code }),

    /** A THROW — the system did not work. Distinct from a refusal on purpose: one is the product
     *  doing its job, the other is the product failing at it, and an alert must never confuse them. */
    threw: (action: string, err: unknown, fields?: LogFields) =>
      emit('ERROR', `${action} threw`, {
        ...base,
        ...fields,
        // The message only. A stack is useful; a stack that has interpolated a member's name into
        // an error string is a PII leak with a stack trace attached.
        errorMessage: err instanceof Error ? err.message : String(err),
      }),
  }
}

// ── The wrapper the money paths run inside ──────────────────────────────────────────────────
// A Server Action has three outcomes and they must never be confused in an alert:
//
//   • it SUCCEEDED     → an event was appended. The event log is already the audit; this line is
//                        the join between that permanent record and the request that produced it.
//   • it was REFUSED   → the domain worked and said no. It writes NO EVENT — so if it is not
//                        logged, it did not happen, and "why couldn't reception book her in?" has
//                        no answer anywhere in the system.
//   • it THREW         → the product failed. This is the only one of the three that is a defect,
//                        and the only one an alarm should ever wake anybody for.
//
// The throw is re-raised, never swallowed: observing a failure is not the same as handling it.
export async function observed<T>(
  action: string,
  ctx: TenantContext,
  correlationId: string | undefined,
  fields: LogFields,
  run: () => Promise<Result<T, DomainError>>,
): Promise<Result<T, DomainError>> {
  const l = logFor(ctx, correlationId)
  try {
    const res = await run()
    if (res.ok) l.info(action, fields)
    else l.refused(action, res.error.code, fields)
    return res
  } catch (err) {
    l.threw(action, err, fields)
    throw err
  }
}

/** For the few lines with no tenant yet — a failed sign-in, a rejected session cookie. */
export const log = {
  info: (message: string, fields?: LogFields) => emit('INFO', message, fields),
  warn: (message: string, fields?: LogFields) => emit('WARNING', message, fields),
  error: (message: string, fields?: LogFields) => emit('ERROR', message, fields),
}
