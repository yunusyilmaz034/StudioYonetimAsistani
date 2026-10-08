import { initializeApp } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'

// BEHİCE ÜNLÜTÜRK — PİLATES PAKETİYLE, REZERVASYONSUZ İÇERİDE: TANI (owner, 2026-10-08)
//
//   pnpm tsx tools/migration/tani-behice-unluturk-2026-10-08.ts
//
// SALT OKUNUR. Owner: *"pilatesi var ama bugüne rezervasyonu yok, içeri girmiş."*
// Ölçülecek: kapıdan NASIL girdi (turnike mi, resepsiyon mu) ve bugüne rezervasyonu gerçekten yok mu.

const STUDIO = 'retro'
const MEMBER = 'mem_01M31JNGSJ7S8QYZ5BGZBBMYRX'
const an = (v: unknown): string => {
  const ms = v instanceof Timestamp ? v.toMillis() : typeof v === 'number' ? v : NaN
  return Number.isNaN(ms) ? '—' : new Date(ms).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' })
}

async function main(): Promise<void> {
  initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID ?? 'studio-yonetim-prod' })
  const db = getFirestore()
  const col = (n: string) => db.collection(`studios/${STUDIO}/${n}`)
  const basla = Date.parse('2026-10-01T00:00:00+03:00')

  const rez = (await col('reservations').where('memberId', '==', MEMBER).get()).docs
    .map((r) => ({ at: (r.get('sessionStartsAt') as Timestamp | number), status: r.get('status') }))
    .filter((r) => (r.at instanceof Timestamp ? r.at.toMillis() : Number(r.at)) >= basla)
    .sort((a, b) => (a.at instanceof Timestamp ? a.at.toMillis() : Number(a.at)) - (b.at instanceof Timestamp ? b.at.toMillis() : Number(b.at)))
  console.log(`━━ REZERVASYONLAR, 1 Ekim'den beri (${rez.length})`)
  for (const r of rez) console.log(`   ${an(r.at)} · ${r.status}`)

  const olaylar = (await col('events').where('related.memberId', '==', MEMBER).get()).docs
    .filter((o) => /^(member\.(checked|entry|exited)|turnstile\.)/.test(String(o.get('type'))))
    .sort((a, b) => a.id.localeCompare(b.id))
  console.log(`\n━━ KAPI OLAYLARI (${olaylar.length})`)
  for (const o of olaylar) {
    console.log(`   ${an(o.get('occurredAt'))} · ${String(o.get('type')).padEnd(28)} · ${o.get('actor.type')} · ${JSON.stringify(o.get('payload') ?? {})}`)
  }
  console.log('\n(salt okunur — hiçbir şey yazılmadı)')
}

main().catch((e) => { console.error(e); process.exit(1) })
