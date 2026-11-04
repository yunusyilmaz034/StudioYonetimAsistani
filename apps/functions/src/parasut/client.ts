import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

import { Timestamp, type Firestore } from 'firebase-admin/firestore'

import { readError } from './api'

// FT-2 · Paraşüt HTTP client + its OAuth tokens.
//
// Paraşüt offers ONLY the authorization-code flow (with PKCE): the owner signs in at Paraşüt once,
// in his own browser, and we keep the refresh token. It ROTATES ("genellikle" — usually), so every
// refresh writes the newest one back, and it dies after ~30 days unused, so the sweep refreshes daily.
//
// Where the tokens live: `studios/{sid}/secrets/parasut` — a server-only collection (firestore.rules
// `serverOnly`), and ENCRYPTED there with a key derived from PARASUT_CLIENT_SECRET, which lives in
// Secret Manager. A Firestore export, or a console glance, shows ciphertext.

export interface ParasutCredentials {
  readonly clientId: string
  readonly clientSecret: string
}

/** Absent until the owner provisions both secrets — every caller then reports `not_connected`. */
export function credentialsFromEnv(): ParasutCredentials | null {
  const clientId = process.env.PARASUT_CLIENT_ID?.trim()
  const clientSecret = process.env.PARASUT_CLIENT_SECRET?.trim()
  return clientId && clientSecret ? { clientId, clientSecret } : null
}

const key = (c: ParasutCredentials) => createHash('sha256').update(`parasut-token:${c.clientSecret}`).digest()

export function seal(c: ParasutCredentials, plain: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key(c), iv)
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return [iv, cipher.getAuthTag(), body].map((b) => b.toString('base64')).join('.')
}

export function unseal(c: ParasutCredentials, sealed: string): string {
  const [iv, tag, body] = sealed.split('.').map((s) => Buffer.from(s, 'base64'))
  if (!iv || !tag || !body) throw new Error('parasut token: malformed')
  const d = createDecipheriv('aes-256-gcm', key(c), iv)
  d.setAuthTag(tag)
  return Buffer.concat([d.update(body), d.final()]).toString('utf8')
}

export const tokenDoc = (database: Firestore, studioId: string) => database.doc(`studios/${studioId}/secrets/parasut`)

export async function saveRefreshToken(database: Firestore, studioId: string, c: ParasutCredentials, refreshToken: string) {
  await tokenDoc(database, studioId).set({ refreshToken: seal(c, refreshToken), refreshedAt: Timestamp.now() }, { merge: true })
}

export class ParasutHttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    super(`parasut ${status}: ${readError(body).message}`)
  }
  /** 4xx other than 401/408/429: Paraşüt looked at it and said no. Retrying the same thing will not help. */
  get rejected() {
    return this.status >= 400 && this.status < 500 && ![401, 408, 429].includes(this.status)
  }
}

export interface ClientOptions {
  readonly database: Firestore
  readonly studioId: string
  readonly companyId: string
  readonly credentials: ParasutCredentials
  readonly apiBase: string
  readonly idBase: string
  readonly fetch?: typeof fetch
}

export class ParasutClient {
  private accessToken: string | null = null
  private readonly f: typeof fetch

  constructor(private readonly o: ClientOptions) {
    this.f = o.fetch ?? fetch
  }

  /** Trade the stored refresh token for an access token; write the rotated refresh token back. */
  async refresh(): Promise<void> {
    const snap = await tokenDoc(this.o.database, this.o.studioId).get()
    const sealed = snap.get('refreshToken')
    if (typeof sealed !== 'string') throw new ParasutNotConnected()
    const res = await this.f(`${this.o.idBase}/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: this.o.credentials.clientId,
        client_secret: this.o.credentials.clientSecret,
        refresh_token: unseal(this.o.credentials, sealed),
      }),
    })
    const body = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string }
    if (!res.ok || !body.access_token) {
      // A dead refresh token is not a transient error: the owner must sign in to Paraşüt again.
      if (res.status === 400 || res.status === 401) throw new ParasutNotConnected()
      throw new ParasutHttpError(res.status, body)
    }
    this.accessToken = body.access_token
    if (body.refresh_token) await saveRefreshToken(this.o.database, this.o.studioId, this.o.credentials, body.refresh_token)
    else await tokenDoc(this.o.database, this.o.studioId).set({ refreshedAt: Timestamp.now() }, { merge: true })
  }

  async request(method: 'GET' | 'POST', path: string, body?: unknown): Promise<{ status: number; body: unknown }> {
    if (!this.accessToken) await this.refresh()
    const go = () =>
      this.f(`${this.o.apiBase}/${this.o.companyId}/${path}`, {
        method,
        headers: {
          authorization: `Bearer ${this.accessToken}`,
          accept: 'application/vnd.api+json',
          ...(body ? { 'content-type': 'application/vnd.api+json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      })
    let res = await go()
    if (res.status === 401) {
      await this.refresh()
      res = await go()
    }
    const parsed: unknown = res.status === 204 ? null : await res.json().catch(() => null)
    return { status: res.status, body: parsed }
  }

  /** `request`, throwing on anything but 2xx. */
  async ok(method: 'GET' | 'POST', path: string, body?: unknown): Promise<unknown> {
    const r = await this.request(method, path, body)
    if (r.status < 200 || r.status >= 300) throw new ParasutHttpError(r.status, r.body)
    return r.body
  }
}

export class ParasutNotConnected extends Error {
  constructor() {
    super('parasut: not connected')
  }
}
