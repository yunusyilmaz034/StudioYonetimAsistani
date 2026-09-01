import {
  allStudioIds,
  FirestoreIdentityRepository,
  newCorrelationId,
  notify,
  runDeepChecks,
  runFastChecks,
  type HealthFinding,
  type StudioId,
  type TenantContext,
} from '@studio/core'
import { getAuth } from 'firebase-admin/auth'
import * as logger from 'firebase-functions/logger'

import { db } from '../shared/firebase'
import { notificationDeps, studioBrand, studioNotificationSettings } from '../triggers/on-event-notify'

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

// ── TELLING THE OWNER ───────────────────────────────────────────────────────────────────────
//
// An ERROR log wakes a Cloud Logging alert, which sends an e-mail to whoever wired the alerting
// policy — a developer. It does not reach the person who can act on the studio floor. So a CRITICAL
// finding is also delivered through the ordinary notification pipeline, to the owner, at `urgent`
// priority (quiet hours must not hold it until 08:00 — that is the whole point of a night check).
//
// Deduplicated to one message per alert per 6 hours: the fast checks run every fifteen minutes, and
// an alarm that repeats every fifteen minutes is an alarm that gets muted, at which point the studio
// is worse off than before it had one.
const ALERT_TR: Record<string, string> = {
  commands_stuck: 'Kaydedilmemiş check-in var',
  projection_lag: 'Gösterge paneli geride kalmış',
  booked_count_drift: 'Bir dersin kontenjan sayacı tutmuyor',
  credit_ledger_drift: 'Bir üyenin kredi hesabı tutmuyor',
  expiring_with_held: 'Bitmek üzere olan pakette bekleyen ders var',
  ai_not_replying: 'WhatsApp asistanı cevap vermiyor',
  notifications_failing: 'Bildirimler gönderilemiyor',
  payments_stuck: 'Online ödemeler yanıt bekliyor',
}

async function tellOwner(studioId: StudioId, findings: readonly HealthFinding[], now: number): Promise<void> {
  const critical = findings.filter((f) => f.severity === 'critical')
  if (critical.length === 0) return

  const ctx: TenantContext = {
    studioId,
    branchIds: [],
    role: 'owner',
    actor: { type: 'system', id: 'health_check' } as TenantContext['actor'],
  }

  const staff = await new FirestoreIdentityRepository(db()).listStaff(ctx)
  const owners = staff.filter((s) => s.active && s.role === 'owner')
  if (owners.length === 0) return

  // MARKA GEÇİRİLİYOR (owner, 2026-09-01). Geçirilmediği için ilk uyarı e-postasının başlığında
  // stüdyonun adı değil, varsayılan "Studio" yazıyordu — sahibinin kendi paneline ait olduğu
  // anlaşılmayan bir uyarı, spam'e en çok benzeyen uyarıdır.
  const [settings, brand] = await Promise.all([studioNotificationSettings(studioId), studioBrand(studioId)])
  const deps = notificationDeps(settings, brand)
  const window = Math.floor(now / (6 * 60 * 60 * 1000)) // one message per alert per 6h

  for (const f of critical) {
    for (const owner of owners) {
      // The owner's e-mail lives in Firebase Auth, not on the staff document — and an alert that only
      // lands in the panel is an alert nobody sees at 04:00.
      let email: string | null = null
      try {
        email = (await getAuth().getUser(owner.id as string)).email ?? null
      } catch {
        // No auth account (a seeded row): in-app still reaches her.
      }

      try {
        await notify(deps, ctx, {
          intentId: `health-${f.alert}-${window}-${owner.id}`,
          eventId: null,
          eventType: 'system.health_alert',
          operationId: newCorrelationId(),
          templateId: 'system_alert',
          recipient: { kind: 'staff', id: owner.id as string, email, phone: null, displayName: owner.displayName },
          params: {
            alertTitle: ALERT_TR[f.alert] ?? f.alert,
            alertDetail: f.detail ?? `${f.count} kayıt etkilendi.`,
          },
        })
      } catch (e) {
        // Never let the alarm's own failure take down the check that raised it.
        logger.warn('health: owner notification failed', { alert: f.alert, error: (e as Error)?.message })
      }
    }
  }
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
    await tellOwner(studioId, findings, now)
    runs.push({ studioId, findings })
  }
  return runs
}

export async function runNightlyHealthChecks(now: number): Promise<readonly HealthRun[]> {
  const runs: HealthRun[] = []
  for (const studioId of await allStudioIds(db())) {
    const findings = await runDeepChecks(db(), studioId, now)
    raise(studioId, findings)
    await tellOwner(studioId, findings, now)

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
