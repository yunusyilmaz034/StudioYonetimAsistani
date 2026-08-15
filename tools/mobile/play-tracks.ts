import { createSign } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// WHICH VERSION IS ACTUALLY ON THE MARKET?
//
//   pnpm android:tracks
//
// ── WHY THIS EXISTS ─────────────────────────────────────────────────────────────────────────
//
// On 2026-08-15 the store served 1.5.0 while everyone believed 1.6.0 had shipped. It had been
// submitted — to the CLOSED TEST track, because `eas.json` hardcoded `"track": "alpha"` from the
// months when production access had not been granted yet. Nothing was broken and nothing said so.
//
// The two obvious places to look both mislead:
//
//   • **The Play Store listing** hides the version — Google shows "Cihaza göre değişir" on most
//     apps now. And under a staged rollout what you see is not what a given member sees.
//   • **Play Console** is accurate but puts each track on its own page, so reading one and
//     concluding something about the app is the easy mistake, and the one that was made.
//
// This asks the Play Developer API for all three tracks at once. It is the same shape of answer as
// OR-17's rule for the panel — "did it deploy?" is answered by Cloud Run's traffic split, not by a
// dashboard that looks like it should know.
//
// ── WHAT IT WILL NEVER DO ───────────────────────────────────────────────────────────────────
//
// Read only. It opens an edit because the API has no other way to read tracks, and DELETES it
// again — an edit that is never committed changes nothing. Promoting a build is a separate,
// deliberate act, and it is not in this file.

const PACKAGE = 'com.pilatesfitnessbyisil.member'
const KEY_PATH = resolve(process.cwd(), 'apps/mobile/google-play-service-account.json')
const API = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PACKAGE}`

// The order a human cares about: what members have, then what is being tested, then the sandbox.
const TRACK_ORDER = ['production', 'beta', 'alpha', 'internal'] as const
const TRACK_TR: Record<string, string> = {
  production: 'ÜRETİM (markette)',
  beta: 'açık test',
  alpha: 'kapalı test',
  internal: 'dahili test',
}

interface Release {
  readonly name?: string
  readonly status?: string
  readonly userFraction?: number
  readonly versionCodes?: readonly string[]
}

async function accessToken(): Promise<string> {
  if (!existsSync(KEY_PATH)) {
    console.error(
      `Servis hesabı bulunamadı: ${KEY_PATH}\n` +
        'Bu dosya gizli ve depoya girmez (apps/mobile/.gitignore). Play Console → Kurulum →\n' +
        'API erişimi bölümünden indirilip oraya konur.',
    )
    process.exit(1)
  }
  const sa = JSON.parse(readFileSync(KEY_PATH, 'utf8')) as { client_email: string; private_key: string }
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const now = Math.floor(Date.now() / 1000)
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/androidpublisher',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  })}`
  const signature = createSign('RSA-SHA256').update(unsigned).end().sign(sa.private_key).toString('base64url')

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${signature}` }),
  })
  const body = (await res.json()) as { access_token?: string; error_description?: string; error?: string }
  if (!body.access_token) {
    console.error(`Jeton alınamadı: ${body.error_description ?? body.error ?? 'bilinmeyen hata'}`)
    process.exit(1)
  }
  return body.access_token
}

async function main(): Promise<void> {
  const headers = { authorization: `Bearer ${await accessToken()}` }

  const edit = (await (await fetch(`${API}/edits`, { method: 'POST', headers })).json()) as { id?: string; error?: { message?: string } }
  if (!edit.id) {
    console.error(`Play düzenlemesi açılamadı: ${edit.error?.message ?? 'bilinmeyen hata'}`)
    process.exit(1)
  }

  try {
    const tracks = (await (await fetch(`${API}/edits/${edit.id}/tracks`, { headers })).json()) as {
      tracks?: readonly { track: string; releases?: readonly Release[] }[]
    }

    // No sort: the loop below walks TRACK_ORDER, which IS the order, so a comparator here would only
    // be a second opinion about it.
    const rows = tracks.tracks ?? []

    console.log(`\n${PACKAGE}\n`)
    for (const name of TRACK_ORDER) {
      const t = rows.find((x) => x.track === name)
      if (!t) continue
      for (const r of t.releases ?? []) {
        // A staged rollout is the case where "which version is live" has TWO answers, so say both.
        const reach =
          r.status === 'inProgress' && typeof r.userFraction === 'number'
            ? `%${Math.round(r.userFraction * 100)} kullanıcıda`
            : r.status === 'completed'
              ? '%100'
              : String(r.status ?? '?')
        console.log(
          `  ${(TRACK_TR[name] ?? name).padEnd(18)} ${String(r.name ?? '?').padEnd(14)} ` +
            `versionCode ${(r.versionCodes ?? []).join(',').padEnd(5)} ${reach}`,
        )
      }
    }
    console.log('')
  } finally {
    // Always. An abandoned edit expires on its own, but leaving them around makes the next person
    // wonder whether somebody is mid-release.
    await fetch(`${API}/edits/${edit.id}`, { method: 'DELETE', headers })
  }
}

void main()
