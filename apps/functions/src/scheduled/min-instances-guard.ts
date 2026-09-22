import * as logger from 'firebase-functions/logger'

// ── THE SETTING THAT KEEPS UNSETTING ITSELF (owner, 2026-09-22) ──────────────────────────────
//
// `apphosting.yaml` has said `minInstances: 1` since 14 August. App Hosting writes it into the BUILD
// config — and then deploys a Cloud Run revision with `minScale: 0`. The container scales to zero
// during every quiet stretch, and reception pays twelve seconds for the first request after it:
// measured, three times, 12.35s / 12.20s / 12.31s, against 0.07s warm. For five weeks that was the
// studio's "sistem çok yavaş".
//
// It was put right by hand on 22 September. Then the next rollout reset it. Then the one after that.
// Three deploys, three resets — so this is not an accident to be fixed once, it is a behaviour to be
// lived with. Known upstream: firebase-tools #10775 and #10606, both closed, neither effective here.
//
// A repair that depends on somebody remembering is not a repair. This runs on a timer, notices the
// zero, and puts the one back.
//
// ── WHY THE RAW REST API ──
// The functions bundle carries firebase-admin and nothing else, deliberately. Adding a Google API
// client for one PATCH would be a dependency the whole deploy has to carry forever. The metadata
// server hands out an access token to any code running on the instance, and Cloud Run's own API is
// two plain HTTP calls away.
//
// ── WHY READ-MODIFY-WRITE, NOT A FIELD MASK ──
// Cloud Run v2 `patch` with `updateMask=template` REPLACES the whole template — container image,
// env, the lot. Sending one field that way is how a working service becomes an empty one. So the
// service is read, one number is changed, and the whole object goes back with its etag. That is
// exactly what `gcloud run services update --min-instances=1` does, and it is the operation we have
// already performed by hand three times.

const METADATA_TOKEN_URL =
  'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token'

/** The panel's Cloud Run service — App Hosting names it after the backend. */
export const PANEL_SERVICE = {
  project: 'studio-yonetim-prod',
  location: 'europe-west4',
  service: 'studio-yonetim',
  /** What `apphosting.yaml` asks for, and what App Hosting keeps dropping. */
  wanted: 1,
} as const

/**
 * PURE — the whole decision, and the only part worth testing.
 *
 * Repair ONLY an explicit zero. A higher number is somebody's deliberate act (a load test, a busy
 * weekend) and stamping it back down to one would undo a human. An absent value means the read
 * failed or the shape changed; guessing from a shape we did not understand is how an automation
 * starts editing production for reasons nobody can reconstruct.
 */
export function needsRepair(current: number | undefined, wanted: number): boolean {
  return current === 0 && wanted > 0
}

async function accessToken(): Promise<string | null> {
  try {
    const res = await fetch(METADATA_TOKEN_URL, {
      headers: { 'Metadata-Flavor': 'Google' },
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) return null
    const body = (await res.json()) as { access_token?: string }
    return body.access_token ?? null
  } catch {
    return null
  }
}

interface RunService {
  readonly etag?: string
  template?: { scaling?: { minInstanceCount?: number; maxInstanceCount?: number } }
}

/**
 * One pass: read the service, and if its floor has been reset to zero, put it back.
 *
 * Returns what happened so the caller can log it — and so silence in the logs means "nothing was
 * wrong", not "nothing ran".
 */
export async function runMinInstancesGuard(): Promise<
  { readonly outcome: 'ok' | 'repaired' | 'unavailable'; readonly found: number | undefined }
> {
  const token = await accessToken()
  if (!token) {
    logger.warn('minInstances: no access token from the metadata server — skipping')
    return { outcome: 'unavailable', found: undefined }
  }

  const base = `https://run.googleapis.com/v2/projects/${PANEL_SERVICE.project}/locations/${PANEL_SERVICE.location}/services/${PANEL_SERVICE.service}`
  const auth = { Authorization: `Bearer ${token}` }

  let service: RunService
  try {
    const res = await fetch(base, { headers: auth, signal: AbortSignal.timeout(20_000) })
    if (!res.ok) {
      logger.warn('minInstances: could not read the service', { status: res.status })
      return { outcome: 'unavailable', found: undefined }
    }
    service = (await res.json()) as RunService
  } catch (e) {
    logger.warn('minInstances: read failed', { error: String(e) })
    return { outcome: 'unavailable', found: undefined }
  }

  const found = service.template?.scaling?.minInstanceCount
  if (!needsRepair(found, PANEL_SERVICE.wanted)) {
    logger.info('minInstances: floor intact', { found })
    return { outcome: 'ok', found }
  }

  // Read-modify-write, whole object, with the etag we just read: if a deploy lands between the read
  // and the write, the etag stops us from overwriting it and the next run picks it up.
  const next = {
    ...service,
    template: { ...service.template, scaling: { ...service.template?.scaling, minInstanceCount: PANEL_SERVICE.wanted } },
  }
  try {
    const res = await fetch(base, {
      method: 'PATCH',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify(next),
      signal: AbortSignal.timeout(30_000),
    })
    if (!res.ok) {
      logger.error('minInstances: repair REJECTED', { status: res.status, body: (await res.text()).slice(0, 400) })
      return { outcome: 'unavailable', found }
    }
  } catch (e) {
    logger.error('minInstances: repair failed', { error: String(e) })
    return { outcome: 'unavailable', found }
  }

  // Loud on purpose: every one of these lines is a deploy that dropped the setting, and the count
  // over time is the evidence for (or against) chasing the upstream bug.
  logger.error('minInstances: floor was 0 after a rollout — restored', {
    service: PANEL_SERVICE.service,
    restoredTo: PANEL_SERVICE.wanted,
  })
  return { outcome: 'repaired', found }
}
