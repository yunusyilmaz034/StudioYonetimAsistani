import { initializeApp } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'

// PANO — "neden −2500 diyor" (owner, 2026-10-12). SALT OKUNUR.
//
//   pnpm tsx tools/migration/tani-pano-eksi-2500-2026-10-12.ts
//
// Bugünün ve son üç günün read model satırı + bugün yazılan para olayları (tahsilat, iptal, iade,
// kasa hareketi) yan yana.

const STUDIO = 'retro'
const an = (ms: number): string => new Date(ms).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' })
const gunStr = (ms: number): string => new Date(ms).toLocaleDateString('sv-SE', { timeZone: 'Europe/Istanbul' })

async function main(): Promise<void> {
  initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID ?? 'studio-yonetim-prod' })
  const s = getFirestore().collection('studios').doc(STUDIO)
  const bugun = gunStr(Date.now())
  const gunBasi = Date.parse(`${bugun}T00:00:00+03:00`)

  console.log('━━ READ MODEL — son 4 gün')
  for (let i = 3; i >= 0; i--) {
    const d = gunStr(gunBasi - i * 86_400_000)
    const doc = await s.collection('readModels').doc('daily').collection('days').doc(d).get()
    console.log(`   ${d} ${JSON.stringify(doc.data() ?? null)}`)
  }

  const snap = await s.collection('events').where('recordedAt', '>=', Timestamp.fromMillis(gunBasi - 86_400_000)).orderBy('recordedAt').get()
  console.log('\n━━ PARA OLAYLARI — dünden beri YAZILAN (kayıt saatine göre)')
  for (const d of snap.docs) {
    const e = d.data()
    if (!/^(payment\.|refund\.|sale\.|drawer\.|cash\.|expense\.|retail\.|discount\.|entitlement\.(purchased|amended|cancelled))/.test(String(e.type))) continue
    console.log(`   kayıt ${an(e.recordedAt.toMillis())} · olay ${an(e.occurredAt.toMillis())} · ${String(e.type).padEnd(28)} · ${e.actor?.type} · ${JSON.stringify(e.payload).slice(0, 420)}`)
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
