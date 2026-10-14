import { createSign } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// ÜRETİMDEKİ KADEMELİ SÜRÜMÜ %100'E ÇIKAR — "androide de yayınla" (owner, 2026-10-14).
//
//   pnpm android:rollout                 → ne yapılacağını GÖSTERİR, hiçbir şey değiştirmez
//   pnpm android:rollout -- --full       → kademeli (inProgress) sürümü `completed` yapar
//
// Play'de üretim kanalında aynı anda bir kademeli ve bir tamamlanmış sürüm durabilir. %100'e çıkmak,
// kademeli olanı `completed` yapıp eskisini kanaldan ÇIKARMAKTIR — Console'daki "Kullanıma sunmayı
// artır → %100" düğmesinin API karşılığı. Sürüm notları olduğu gibi taşınır (`android:notes`).
// Google incelemesi sürüyorsa değişiklik incelemeyle birlikte uygulanır; bu betik incelemeyi atlatmaz.

const PACKAGE = 'com.pilatesfitnessbyisil.member'
const KEY_PATH = resolve(process.cwd(), 'apps/mobile/google-play-service-account.json')
const API = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PACKAGE}`

interface Release {
  readonly name?: string
  readonly status?: string
  readonly userFraction?: number
  readonly versionCodes?: readonly string[]
  readonly releaseNotes?: readonly { language?: string; text?: string }[]
}

async function accessToken(): Promise<string> {
  if (!existsSync(KEY_PATH)) {
    console.error(`Servis hesabı bulunamadı: ${KEY_PATH}`)
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
  const body = (await res.json()) as { access_token?: string; error_description?: string }
  if (!body.access_token) {
    console.error(`Jeton alınamadı: ${body.error_description ?? 'bilinmeyen hata'}`)
    process.exit(1)
  }
  return body.access_token
}

async function main(): Promise<void> {
  const full = process.argv.includes('--full')
  const headers = { authorization: `Bearer ${await accessToken()}`, 'content-type': 'application/json' }
  const edit = (await (await fetch(`${API}/edits`, { method: 'POST', headers })).json()) as { id?: string; error?: { message?: string } }
  if (!edit.id) {
    console.error(`Play düzenlemesi açılamadı: ${edit.error?.message ?? 'bilinmeyen hata'}`)
    process.exit(1)
  }
  let committed = false
  try {
    const track = (await (await fetch(`${API}/edits/${edit.id}/tracks/production`, { headers })).json()) as { releases?: readonly Release[] }
    const releases = track.releases ?? []
    for (const r of releases)
      console.log(`  sürüm ${r.name ?? '?'} · versionCode ${(r.versionCodes ?? []).join(', ')} · ${r.status ?? '?'}${r.userFraction != null ? ` · %${Math.round(r.userFraction * 100)}` : ''}`)
    const staged = releases.filter((r) => r.status === 'inProgress')
    if (staged.length !== 1) {
      console.error(`\nDUR: tam olarak bir kademeli sürüm bekleniyordu, ${staged.length} var.`)
      process.exit(1)
    }
    const s = staged[0]!
    console.log(`\nHEDEF: ${s.name} (versionCode ${(s.versionCodes ?? []).join(', ')}) → %100, eskiler kanaldan çıkar.`)
    if (!(s.releaseNotes ?? []).length) console.log('⚠️  Bu sürümün notu yok — önce pnpm android:notes -- --write <dosya>')
    if (!full) {
      console.log('\n(kuru çalışma — uygulamak için: pnpm android:rollout -- --full)')
      return
    }
    const put = await fetch(`${API}/edits/${edit.id}/tracks/production`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        track: 'production',
        releases: [
          {
            ...(s.name != null ? { name: s.name } : {}),
            status: 'completed',
            versionCodes: [...(s.versionCodes ?? [])],
            ...(s.releaseNotes ? { releaseNotes: s.releaseNotes } : {}),
          },
        ],
      }),
    })
    if (!put.ok) {
      console.error(`\nKanal yazılamadı: ${put.status} ${await put.text()}`)
      process.exit(1)
    }
    const commit = await fetch(`${API}/edits/${edit.id}:commit`, { method: 'POST', headers })
    if (!commit.ok) {
      console.error(`\nDüzenleme işlenemedi: ${commit.status} ${await commit.text()}`)
      process.exit(1)
    }
    committed = true
    console.log('\n✓ %100 yapıldı. Doğrulamak için: pnpm android:tracks')
  } finally {
    if (!committed) await fetch(`${API}/edits/${edit.id}`, { method: 'DELETE', headers }).catch(() => {})
  }
}

void main()
