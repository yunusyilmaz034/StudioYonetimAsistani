import {
  allStudioIds,
  FirestoreIdentityRepository,
  newCorrelationId,
  notify,
  type StudioId,
  type TenantContext,
} from '@studio/core'
import { getAuth } from 'firebase-admin/auth'
import * as logger from 'firebase-functions/logger'

import { db } from '../shared/firebase'
import { notificationDeps, studioNotificationSettings } from '../triggers/on-event-notify'

import { runInfrastructureChecks, type InfraFinding } from './infrastructure-watch'

// Raising the alarm for the infrastructure checks. Separated from the checks themselves for the same
// reason the health checks are: a check that also owns its delivery cannot be tested without a
// mailbox, and the screen has to be able to run the same checks without sending anything.

const ALERT_TR: Record<string, string> = {
  domain_expiring: 'Alan adının süresi doluyor',
  domain_hold: 'Alan adı askıya alınmış',
  ssl_expiring: 'Güvenlik sertifikası yenilenmemiş',
  site_unreachable: 'Siteye ulaşılamıyor',
  renewal_due: 'Yenileme zamanı geldi',
}

// One message per alert+subject per DAY. These are dates, not events: the domain does not expire
// twice, and an alarm that repeats hourly is an alarm that gets muted.
const dayWindow = (now: number): number => Math.floor(now / 86_400_000)

async function tellOwner(studioId: StudioId, findings: readonly InfraFinding[], now: number): Promise<void> {
  const loud = findings.filter((f) => f.severity === 'critical')
  if (loud.length === 0) return

  const ctx: TenantContext = {
    studioId,
    branchIds: [],
    role: 'owner',
    actor: { type: 'system', id: 'infrastructure_watch' } as TenantContext['actor'],
  }

  const staff = await new FirestoreIdentityRepository(db()).listStaff(ctx)
  const owners = staff.filter((s) => s.active && s.role === 'owner')
  if (owners.length === 0) return

  const deps = notificationDeps(await studioNotificationSettings(studioId))
  const win = dayWindow(now)

  for (const f of loud) {
    for (const owner of owners) {
      let email: string | null = null
      try {
        email = (await getAuth().getUser(owner.id as string)).email ?? null
      } catch {
        /* no auth account — in-app still reaches her */
      }
      try {
        await notify(deps, ctx, {
          intentId: `infra-${f.alert}-${f.subject}-${win}-${owner.id}`.slice(0, 180),
          eventId: null,
          eventType: 'system.infrastructure_alert',
          operationId: newCorrelationId(),
          templateId: 'system_alert',
          recipient: { kind: 'staff', id: owner.id as string, email, phone: null, displayName: owner.displayName },
          params: {
            alertTitle: `${ALERT_TR[f.alert] ?? f.alert} — ${f.subject}`,
            alertDetail: f.detail,
          },
        })
      } catch (e) {
        logger.warn('infra: owner notification failed', { alert: f.alert, error: (e as Error)?.message })
      }
    }
  }
}

// ── The weekly heartbeat ────────────────────────────────────────────────────────────────────
//
// The one failure this system cannot report is its own death: if the project is suspended over an
// unpaid bill, the watchdog is suspended with it and every alarm goes quiet — which looks exactly
// like "everything is fine".
//
// So once a week, when all is well, the owner gets a message saying so. The contract is stated in
// the message itself: if this stops arriving, something is wrong. Silence becomes a signal instead
// of an absence.
async function heartbeat(studioId: StudioId, findings: readonly InfraFinding[], now: number): Promise<void> {
  const day = new Date(now + 3 * 3600_000).getUTCDay()
  if (day !== 1) return // Mondays

  const ctx: TenantContext = {
    studioId,
    branchIds: [],
    role: 'owner',
    actor: { type: 'system', id: 'infrastructure_watch' } as TenantContext['actor'],
  }
  const staff = await new FirestoreIdentityRepository(db()).listStaff(ctx)
  const owners = staff.filter((s) => s.active && s.role === 'owner')
  if (owners.length === 0) return

  const deps = notificationDeps(await studioNotificationSettings(studioId))
  const week = Math.floor(now / (7 * 86_400_000))
  const warn = findings.filter((f) => f.severity === 'warning')

  for (const owner of owners) {
    let email: string | null = null
    try {
      email = (await getAuth().getUser(owner.id as string)).email ?? null
    } catch {
      /* in-app only */
    }
    try {
      await notify(deps, ctx, {
        intentId: `infra-heartbeat-${week}-${owner.id}`,
        eventId: null,
        eventType: 'system.infrastructure_heartbeat',
        operationId: newCorrelationId(),
        templateId: 'system_heartbeat',
        recipient: { kind: 'staff', id: owner.id as string, email, phone: null, displayName: owner.displayName },
        params: {
          summary:
            warn.length === 0
              ? 'Alan adı, sertifikalar, site erişimi ve yenileme tarihleri kontrol edildi — hepsi yolunda.'
              : `Dikkat edilecekler: ${warn.map((f) => `${f.subject} (${f.detail})`).join(' · ')}`,
        },
      })
    } catch (e) {
      logger.warn('infra: heartbeat failed', { error: (e as Error)?.message })
    }
  }
}

// ── The dead man's switch (Operasyon kapısı · 2026-08-09). ─────────────────────────────────
//
// Every alarm in this file is raised BY US, FROM INSIDE the project it watches. That is the one
// failure it structurally cannot report: if the project is suspended over an unpaid bill, or the
// functions stop deploying, or the schedule is deleted, every check goes quiet — and quiet is
// exactly what "nothing is wrong" looks like. A monitor that can only speak when it is healthy is
// not a monitor.
//
// So the sweep reports to something OUTSIDE: a URL that expects to hear from us on a schedule and
// shouts when it does not. Silence becomes the signal, which is the only shape that survives our own
// death. The external service is the owner's account (see docs/RUNBOOK.md); this end is one POST.
//
// ⚠️ **What this does NOT prove.** It proves the scheduled FUNCTION ran. The panel is App Hosting
// and can be down while this pings happily — so the runbook pairs it with an external HTTP check on
// the panel itself. A green that answers a question nobody asked is worse than a red (OR-17).
async function pingDeadMansSwitch(studiosChecked: number, studiosFailed: number): Promise<void> {
  const url = process.env.HEARTBEAT_URL
  if (!url) {
    // Loud, like the e-mail and WhatsApp transports: an unconfigured monitor must never be mistaken
    // for a passing one.
    logger.warn('infra: dead man\'s switch is NOT configured — nobody outside would notice our silence', {
      alert: 'heartbeat_not_configured',
    })
    return
  }
  // Every studio failed ⇒ the sweep ran but learned nothing. Reporting success would be a lie, and
  // staying silent is precisely the signal the external service is watching for.
  if (studiosChecked > 0 && studiosFailed === studiosChecked) {
    logger.error('infra: every studio check failed — NOT pinging the switch', { alert: 'infra_watch_total_failure' })
    return
  }
  try {
    // A hanging ping must not hang the nightly sweep, and a failed ping must not break it: this is
    // the last statement of the run, and its whole job is to be missed rather than to succeed.
    await fetch(url, { method: 'POST', signal: AbortSignal.timeout(10_000) })
  } catch (e) {
    logger.warn('infra: heartbeat ping failed', { error: (e as Error)?.message, alert: 'heartbeat_ping_failed' })
  }
}

export async function runInfrastructureWatch(now: number): Promise<void> {
  const studioIds = await allStudioIds(db())
  let failed = 0
  for (const studioId of studioIds) {
    try {
      const report = await runInfrastructureChecks(studioId)
      await tellOwner(studioId, report.findings, now)
      await heartbeat(studioId, report.findings, now)
      // Kept so the panel can show the last result without re-running network checks on every load.
      await db()
        .doc(`studios/${studioId}/settings/infrastructureStatus`)
        .set({ checkedAt: now, findings: report.findings }, { merge: true })
    } catch (e) {
      failed += 1
      // One studio's failure must not stop the rest — and must not be silent either.
      logger.error('infra: watch failed', { studioId, error: (e as Error)?.message, alert: 'infra_watch_failed' })
    }
  }
  await pingDeadMansSwitch(studioIds.length, failed)
}
