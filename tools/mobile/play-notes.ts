import { createSign } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// SÜRÜM NOTLARINI OKU / YAZ — "Yenilikler" boş çıkmasın.
//
//   pnpm android:notes                       → üretimdeki sürümün notlarını OKUR
//   pnpm android:notes -- --write <dosya>     → o metni notlar olarak YAZAR (tek dokunuş, tek kanal)
//
// ── NEDEN VAR ───────────────────────────────────────────────────────────────────────────────
//
// `eas submit` sürüm notu YAZAMAZ. Bu iki kez ısırdı:
//
//   • 2026-08-15 — 1.6.0 üretime yükseltildi ve uygulamanın gördüğü en büyük görsel değişiklikte
//     "Yenilikler" BOŞ kaldı. Fark edilmesi tesadüftü.
//   • 2026-09-03 — 1.7.1 gönderildi, aynı şey tekrar oldu. Ölçüldü: `releaseNotes` boş.
//
// İki kez aynı yere düşmenin sebebi, eksikliğin hiçbir yerde hata gibi görünmemesi: gönderim
// başarılı döner, sürüm %100 yayına çıkar, ve mağaza sayfasında yalnızca bir alan boş durur. Bu
// yüzden artık ÖLÇÜLEBİLİR: notlar yoksa bu betik bağırıyor.
//
// ── YAZMA HAKKINDA ──────────────────────────────────────────────────────────────────────────
//
// Yazmak `--write` ister; kazara çalıştırmak hiçbir şey değiştirmez. Yazılan tek şey ÜRETİM
// kanalının mevcut sürümünün notlarıdır — `versionCodes`, `status` ve `userFraction` OLDUĞU GİBİ
// geri gönderilir. Sürüm yükseltmek, kanal değiştirmek, dağıtım oranı oynatmak bu dosyanın işi
// DEĞİLDİR; onlar ayrı ve bilinçli eylemler.
//
// Dil `tr-TR`: mağaza tek dilli (2026-08-15'te öyle bırakıldı).

const PACKAGE = 'com.pilatesfitnessbyisil.member'
const KEY_PATH = resolve(process.cwd(), 'apps/mobile/google-play-service-account.json')
const API = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PACKAGE}`
const LANG = 'tr-TR'
const MAX = 500 // Google'ın sınırı; aşan metin sessizce kesilmez, gönderim REDDEDİLİR

interface ReleaseNote {
  readonly language?: string
  readonly text?: string
}
interface Release {
  readonly name?: string
  readonly status?: string
  readonly userFraction?: number
  readonly versionCodes?: readonly string[]
  readonly releaseNotes?: readonly ReleaseNote[]
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
  const args = process.argv.slice(2)
  const writeAt = args.indexOf('--write')
  const notesPath = writeAt >= 0 ? args[writeAt + 1] : undefined
  if (writeAt >= 0 && !notesPath) {
    console.error('Kullanım: pnpm android:notes -- --write <notlar.txt>')
    process.exit(1)
  }

  let text = ''
  if (notesPath) {
    if (!existsSync(notesPath)) {
      console.error(`Not dosyası yok: ${notesPath}`)
      process.exit(1)
    }
    text = readFileSync(notesPath, 'utf8').trim()
    if (!text) {
      console.error('Not dosyası BOŞ. Boş not yazmak, notu hiç yazmamakla aynı şey — reddedildi.')
      process.exit(1)
    }
    if (text.length > MAX) {
      console.error(`Not ${text.length} karakter; Google sınırı ${MAX}. Kısalt — uzun metin sessizce kesilmiyor, gönderim reddediliyor.`)
      process.exit(1)
    }
  }

  const headers = { authorization: `Bearer ${await accessToken()}`, 'content-type': 'application/json' }
  const edit = (await (await fetch(`${API}/edits`, { method: 'POST', headers })).json()) as { id?: string; error?: { message?: string } }
  if (!edit.id) {
    console.error(`Play düzenlemesi açılamadı: ${edit.error?.message ?? 'bilinmeyen hata'}`)
    process.exit(1)
  }

  try {
    const track = (await (await fetch(`${API}/edits/${edit.id}/tracks/production`, { headers })).json()) as { releases?: readonly Release[] }
    const releases = track.releases ?? []
    if (releases.length === 0) {
      console.error('Üretim kanalında sürüm yok.')
      process.exit(1)
    }

    console.log(`\n${PACKAGE} — ÜRETİM\n`)
    for (const r of releases) {
      const notes = r.releaseNotes ?? []
      console.log(`  sürüm ${r.name ?? '?'} · versionCode ${(r.versionCodes ?? []).join(', ')} · ${r.status ?? '?'}`)
      if (notes.length === 0) console.log('  ⚠️  SÜRÜM NOTU YOK — mağaza sayfasında "Yenilikler" boş görünüyor')
      else for (const n of notes) console.log(`  [${n.language}] ${(n.text ?? '').replace(/\n/g, ' / ')}`)
    }

    if (!notesPath) {
      console.log('\nYazmak için:  pnpm android:notes -- --write <notlar.txt>\n')
      return
    }

    // Yalnızca notlar değişir. Diğer alanlar OLDUĞU GİBİ geri gönderilir — bir sürümün dağıtım
    // oranını ya da durumunu bu betikten oynatmak, yapmadığı bir şeyi yapması olurdu.
    const patched = releases.map((r) => ({
      ...(r.name != null ? { name: r.name } : {}),
      ...(r.status != null ? { status: r.status } : {}),
      ...(r.userFraction != null ? { userFraction: r.userFraction } : {}),
      ...(r.versionCodes != null ? { versionCodes: [...r.versionCodes] } : {}),
      releaseNotes: [{ language: LANG, text }],
    }))
    const put = await fetch(`${API}/edits/${edit.id}/tracks/production`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ track: 'production', releases: patched }),
    })
    if (!put.ok) {
      console.error(`\nNot yazılamadı: ${put.status} ${await put.text()}`)
      process.exit(1)
    }
    const commit = await fetch(`${API}/edits/${edit.id}:commit`, { method: 'POST', headers })
    if (!commit.ok) {
      console.error(`\nDüzenleme işlenemedi: ${commit.status} ${await commit.text()}`)
      process.exit(1)
    }
    console.log(`\n✓ ${LANG} sürüm notu yazıldı (${text.length} karakter). Doğrulamak için: pnpm android:notes\n`)
    return
  } finally {
    // Yazmadıysak düzenlemeyi at: işlenmeyen bir düzenleme hiçbir şeyi değiştirmez.
    if (!notesPath) await fetch(`${API}/edits/${edit.id}`, { method: 'DELETE', headers }).catch(() => {})
  }
}

void main()
