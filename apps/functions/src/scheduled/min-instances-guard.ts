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
 * ── ZERO IS AN ABSENCE, NOT A ZERO (measured 2026-09-22, before this shipped) ──
 *
 * The first version asked "is the value exactly 0?" and would never have fired: Cloud Run OMITS
 * `minInstanceCount` when it is zero, so a scaled-to-sleep service reads `{"maxInstanceCount": 2}`
 * and the field is simply missing. Treating a missing field as "unknown, do nothing" made the guard
 * silent in precisely the situation it exists for. It was caught by setting the floor to 0 on the
 * live service on purpose and watching the guard do nothing.
 *
 * So: a `scaling` object we can read, with no floor in it, IS a floor of zero. What still means
 * "do nothing" is the absence of the `scaling` object itself — that is the API having a different
 * shape than we understood, and an automation that edits production on a shape it cannot read is
 * how you get changes nobody can reconstruct.
 *
 * A HIGHER number is left alone: somebody raised it on purpose (a load test, a busy weekend), and
 * stamping a human's deliberate act back down is worse than not running at all.
 */
export function needsRepair(scaling: { minInstanceCount?: number } | undefined, wanted: number): boolean {
  if (!scaling) return false
  return (scaling.minInstanceCount ?? 0) === 0 && wanted > 0
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
  template?: {
    /**
     * The revision NAME Cloud Run gave the running revision. Read-only in practice: sending it back
     * with any changed field is rejected with 409 "Revision named … with different configuration
     * already exists" — which is exactly what this guard did, silently, every ten minutes for three
     * days (23–25 September). It must be stripped before the write so Cloud Run mints a new name.
     */
    revision?: string
    scaling?: { minInstanceCount?: number; maxInstanceCount?: number }
  }
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

  // Alan yoksa sıfırdır (yukarıdaki ölçüm): log da öyle yazsın, yoksa "found: undefined" satırı
  // okuyanı "değeri bilmiyoruz" sanmaya iter — oysa biliyoruz, sıfır.
  const found = service.template?.scaling ? (service.template.scaling.minInstanceCount ?? 0) : undefined
  if (!needsRepair(service.template?.scaling, PANEL_SERVICE.wanted)) {
    logger.info('minInstances: floor intact', { found })
    return { outcome: 'ok', found }
  }

  // Read-modify-write, whole object, with the etag we just read: if a deploy lands between the read
  // and the write, the etag stops us from overwriting it and the next run picks it up.
  // ── REVİZYON ADI GERİ GÖNDERİLMEZ (ölçüldü 25 Eylül) ──────────────────────────────────────
  //
  // Servisi okuyup aynen geri yazmak, `template.revision` alanını da geri göndermek demekti; Cloud
  // Run buna 409 ile cevap veriyor: *"Revision named 'studio-yonetim-build-…' with different
  // configuration already exists."* Yani onarım her seferinde REDDEDİLDİ — sessizce, on dakikada
  // bir. Elle yaptığım denemede çalışmıştı, çünkü o an servisin şablonunda bu ad yoktu; gerçek
  // rollout'ların bıraktığı adla hiç denenmemişti.
  //
  // Ad silinince Cloud Run yenisini kendisi üretir. Geri kalan her alan olduğu gibi gider — amaç
  // hâlâ "tek bir sayıyı değiştir", şablonu yeniden yazmak değil.
  const sablon = { ...(service.template ?? {}) }
  delete sablon.revision
  const next = {
    ...service,
    template: { ...sablon, scaling: { ...sablon.scaling, minInstanceCount: PANEL_SERVICE.wanted } },
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
