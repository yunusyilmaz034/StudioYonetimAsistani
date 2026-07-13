import {
  allStudioIds,
  runDeepChecks,
  runFastChecks,
  type HealthFinding,
  type StudioId,
} from '@studio/core'
import * as logger from 'firebase-functions/logger'

import { db } from '../shared/firebase'

// The five signals (Doc 6 §9), and the reason they are worth a scheduled function at all:
// **each of them fails SILENTLY.** Nothing crashes, nobody is told, and the product carries on
// looking exactly as correct as it did yesterday. A studio would discover the first of them when a
// member says "I checked in and it never counted", weeks later — which is to say, never usefully.
//
// ── What this file is, after v1.27 S7 ────────────────────────────────────────────────────────
// The checks themselves now live in `@studio/core` (`operations/infrastructure/health.ts`), because
// the owner's **Sistem Uyarıları** screen must run *the same* checks. Two implementations of "is
// this studio healthy?" are two answers, and the day they drift is the day the screen says all-clear
// about a studio the alarm is already shouting about.
//
// What is left here is what only a scheduled function can do: walk every studio, and RAISE THE
// ALARM. The `alert` field is the alarm's contract — a Cloud Logging log-based alert matches on it,
// and the runbook has an entry for every value it can take. An alert with no runbook entry is a
// pager that teaches nobody anything.
//
// And still, and above all:  THE CHECK REPORTS. IT NEVER REPAIRS.

/** One log line per finding, at ERROR, carrying the `alert` the alarm and the runbook agree on. */
function raise(studioId: StudioId, findings: readonly HealthFinding[]): void {
  for (const f of findings) {
    logger.error(`health: ${f.alert}`, {
      alert: f.alert,
      studioId,
      severity: f.severity,
      count: f.count,
      detail: f.detail,
      // Ids, never payloads. A log line is not a place to reconstruct a member's day.
      ids: f.ids,
    })
  }
}

export interface HealthRun {
  readonly studioId: StudioId
  readonly findings: readonly HealthFinding[]
}

// The runs RETURN their findings and log them as a side effect — rather than only logging, which
// would leave the alarm testable exclusively by spying on a logger. A monitor whose only observable
// behaviour is a log line is a monitor you cannot prove works, and an alarm nobody proved is an
// assurance, not a control.

export async function runFastHealthChecks(now: number): Promise<readonly HealthRun[]> {
  const runs: HealthRun[] = []
  for (const studioId of await allStudioIds(db())) {
    const findings = await runFastChecks(db(), studioId, now)
    raise(studioId, findings)
    runs.push({ studioId, findings })
  }
  return runs
}

export async function runNightlyHealthChecks(now: number): Promise<readonly HealthRun[]> {
  const runs: HealthRun[] = []
  for (const studioId of await allStudioIds(db())) {
    const findings = await runDeepChecks(db(), studioId, now)
    raise(studioId, findings)

    // A summary line even when everything is fine. A monitor only ever heard from when it is angry
    // is a monitor nobody can tell apart from a broken one.
    logger.info('health: nightly checks complete', {
      studioId,
      findings: findings.length,
      clean: findings.length === 0,
    })
    runs.push({ studioId, findings })
  }
  return runs
}
