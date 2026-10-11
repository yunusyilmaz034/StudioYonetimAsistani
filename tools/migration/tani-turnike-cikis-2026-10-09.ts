import { initializeApp } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'

// TURNİKE — "güle güle diyor, çıkış kolu dönmüyor" (owner, 2026-10-09). SALT OKUNUR.
//
//   pnpm tsx tools/migration/tani-turnike-cikis-2026-10-09.ts
//
// Soru: yazılım mı, röle/kablo mu? Tek kart iki röleyi sürüyor ve darbe sayacı ORTAK — iki ölçüm
// arasındaki sayaç farkı, aynı aralıkta sunucunun kabul ettiği geçiş sayısıyla yan yana konur.

const STUDIO = 'retro'
const saat = (ms: number): string => new Date(ms).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' })

async function main(): Promise<void> {
  initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID ?? 'studio-yonetim-prod' })
  const db = getFirestore()
  const s = db.collection('studios').doc(STUDIO)

  const cihazlar = async () => (await s.collection('devices').get()).docs.map((d) => ({ id: d.id, ...(d.data() as Record<string, FirebaseFirestore.DocumentData[string]>) }))
  const yaz = (c: Record<string, FirebaseFirestore.DocumentData[string]>) =>
    console.log(`   ${c.name} [${c.id.slice(0, 12)}] yön=${c.direction ?? '-'} aktif=${c.active} son=${c.lastSeenAt ? saat(c.lastSeenAt.toMillis()) : '-'} · ${JSON.stringify(c.telemetry ?? null)}`)

  console.log('━━ CİHAZLAR (şimdi)')
  const ilk = await cihazlar()
  ilk.forEach(yaz)

  const gunBasi = Date.parse(new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Istanbul' }) + 'T00:00:00+03:00')
  const dun = gunBasi - 86_400_000
  const snap = await s.collection('events').where('occurredAt', '>=', Timestamp.fromMillis(dun)).orderBy('occurredAt').get()
  const kapi = snap.docs.map((d) => d.data()).filter((e) => /^(member\.(checked_in|checked_out|exited|entry_refused)|turnstile\.|staff\.(clock|shift))/.test(e.type) || /exit|turnstile/.test(e.type))
  for (const [ad, bas] of [['DÜN', dun], ['BUGÜN', gunBasi]] as const) {
    const g = kapi.filter((e) => e.occurredAt.toMillis() >= bas && e.occurredAt.toMillis() < bas + 86_400_000)
    const say: Record<string, number> = {}
    g.forEach((e) => { const k = `${e.type} · ${e.source ?? ''}`; say[k] = (say[k] ?? 0) + 1 })
    console.log(`\n━━ ${ad} — kapı olayları`)
    Object.entries(say).forEach(([k, n]) => console.log(`   ${String(n).padStart(3)}  ${k}`))
  }
  console.log('\n━━ BUGÜN — sırayla')
  kapi.filter((e) => e.occurredAt.toMillis() >= gunBasi).forEach((e) =>
    console.log(`   ${saat(e.occurredAt.toMillis()).slice(-8)}  ${e.type.padEnd(34)} ${String(e.source ?? '').padEnd(14)} ${JSON.stringify(e.payload).slice(0, 150)}`))
}

main().catch((e) => { console.error(e); process.exit(1) })
