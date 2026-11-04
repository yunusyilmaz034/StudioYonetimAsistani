import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

import { Timestamp } from 'firebase-admin/firestore'
import * as logger from 'firebase-functions/logger'
import { onRequest } from 'firebase-functions/v2/https'

import { PARASUT_PROD } from '../parasut/api'
import { credentialsFromEnv, saveRefreshToken } from '../parasut/client'
import { db } from '../shared/firebase'
import { PARASUT_SECRETS, REGION } from '../shared/region'

// FT-2 · "Paraşüt'e bağlan" — the one-time sign-in (authorization code + PKCE; Paraşüt offers no other).
//
//   panel (owner, Belge ayarları) ─ticket─▶ GET ?studio&ticket  → we mint PKCE + state, redirect to Paraşüt
//   owner signs in AT PARAŞÜT (his password never touches us) → GET ?code&state → token exchange
//   → refresh token sealed into secrets/parasut → back to the panel
//
// The panel's ticket is single-use and lives 10 minutes; only its hash is stored. The redirect URI is
// THIS function's URL and must be the one registered in the Paraşüt API application (it cannot be
// changed afterwards — a new application is needed), so it is printed in HANDOVER, not guessed.

export const PARASUT_REDIRECT_URI = 'https://europe-west1-studio-yonetim-prod.cloudfunctions.net/parasutOAuth'

const sha = (s: string) => createHash('sha256').update(s).digest('hex')
const b64url = (b: Buffer) => b.toString('base64url')
const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))
const page = (msg: string) =>
  `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><body style="font:16px system-ui;padding:32px">${msg}</body>`

export const parasutOAuth = onRequest({ region: REGION, secrets: [...PARASUT_SECRETS] }, async (req, res) => {
  const credentials = credentialsFromEnv()
  if (!credentials) {
    res.status(503).send(page('Paraşüt anahtarları henüz tanımlı değil.'))
    return
  }
  const q = req.query as Record<string, string | undefined>
  try {
    // ── 1 · start: the panel sent the owner here with a ticket ──
    if (q.ticket && q.studio) {
      const ref = db().doc(`studios/${q.studio}/secrets/parasutOAuth`)
      const s = await ref.get()
      const expires = s.get('expiresAt') as Timestamp | undefined
      if (!s.exists || !expires || expires.toMillis() < Date.now() || !same(String(s.get('ticketHash')), sha(q.ticket))) {
        res.status(400).send(page('Bağlantı linkinin süresi dolmuş. Panelden yeniden “Paraşüt’e bağlan”a basın.'))
        return
      }
      const verifier = b64url(randomBytes(48))
      const state = b64url(randomBytes(24))
      await ref.set({ ticketHash: null, verifier, stateHash: sha(state), expiresAt: Timestamp.fromMillis(Date.now() + 10 * 60_000) }, { merge: true })
      const idBase = String(s.get('idBase') || PARASUT_PROD.idBase)
      const url = new URL(`${idBase}/auth`)
      url.search = new URLSearchParams({
        client_id: credentials.clientId,
        response_type: 'code',
        scope: 'openid',
        redirect_uri: PARASUT_REDIRECT_URI,
        code_challenge: b64url(createHash('sha256').update(verifier).digest()),
        code_challenge_method: 'S256',
        state: `${q.studio}.${state}`,
      }).toString()
      res.redirect(302, url.toString())
      return
    }

    // ── 2 · callback: Paraşüt sent the owner back with a code ──
    if (q.code && q.state) {
      const dot = q.state.indexOf('.')
      const studio = q.state.slice(0, dot)
      const state = q.state.slice(dot + 1)
      const ref = db().doc(`studios/${studio}/secrets/parasutOAuth`)
      const s = await ref.get()
      const expires = s.get('expiresAt') as Timestamp | undefined
      if (dot <= 0 || !s.exists || !expires || expires.toMillis() < Date.now() || !same(String(s.get('stateHash')), sha(state))) {
        res.status(400).send(page('Oturum doğrulanamadı. Panelden yeniden “Paraşüt’e bağlan”a basın.'))
        return
      }
      const idBase = String(s.get('idBase') || PARASUT_PROD.idBase)
      const r = await fetch(`${idBase}/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: credentials.clientId,
          client_secret: credentials.clientSecret,
          code: q.code,
          redirect_uri: PARASUT_REDIRECT_URI,
          code_verifier: String(s.get('verifier')),
        }),
      })
      const body = (await r.json().catch(() => ({}))) as { refresh_token?: string }
      if (!r.ok || !body.refresh_token) {
        logger.warn('parasut oauth: token exchange refused', { studio, status: r.status })
        res.status(502).send(page('Paraşüt bağlantıyı onaylamadı. Biraz sonra yeniden deneyin.'))
        return
      }
      await saveRefreshToken(db(), studio, credentials, body.refresh_token)
      await db().doc(`studios/${studio}/secrets/parasut`).set({ connectedAt: Timestamp.now() }, { merge: true })
      const back = String(s.get('returnTo') || '')
      await ref.delete()
      if (/^https:\/\//.test(back)) res.redirect(302, `${back}?parasut=bagli`)
      else res.status(200).send(page('Paraşüt bağlandı. Bu sekmeyi kapatabilirsiniz.'))
      return
    }

    res.status(400).send(page('Eksik istek.'))
  } catch (e) {
    logger.error('parasut oauth failed', { error: (e as Error)?.message })
    res.status(500).send(page('Bir şey ters gitti. Panelden yeniden deneyin.'))
  }
})
