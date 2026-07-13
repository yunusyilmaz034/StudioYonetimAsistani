'use server'

import { runDeepChecks, runFastChecks, type HealthFinding } from '@studio/core'

import { requireTenantContext } from '../auth'
import { adminDb } from '../firebase-admin'

// SİSTEM UYARILARI (v1.27 S7) — the five signals, on a screen.
//
// They have existed since v1.26 and nobody could see them: they went to Cloud Logging, which is a
// place for an engineer at 3am, not for the woman who has to decide whether to trust today's numbers.
// A monitor the owner cannot read is a monitor that protects the system from her rather than for her.
//
// It runs the checks LIVE, on load, rather than reading the last nightly run. Two reasons: a stale
// health report is the exact thing this screen exists to warn about, and the checks are bounded
// (they are the same ones a scheduled function runs in seconds). What she sees is true *now*.
//
// The screen REPORTS. There is no repair button, and there will not be one: a self-healing system
// hides its bugs, and a drift is the evidence that a write path bypassed a transaction.

const OWNER = ['owner'] as const

export interface HealthScreenReport {
  readonly checkedAt: number
  readonly findings: readonly HealthFinding[]
}

export async function loadHealthAction(): Promise<HealthScreenReport> {
  const ctx = await requireTenantContext(OWNER)
  const now = Date.now()
  const db = adminDb()

  const [fast, deep] = await Promise.all([
    runFastChecks(db, ctx.studioId, now),
    runDeepChecks(db, ctx.studioId, now),
  ])
  return { checkedAt: now, findings: [...fast, ...deep] }
}
