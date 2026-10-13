import { initializeApp } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'

// GAMZE PİLATİN — pasif paket 06.10'da bitmiş, 27.10'a uzatılacak: TANI (owner, 2026-10-13). SALT OKUNUR.
//
//   pnpm tsx tools/migration/tani-gamze-pilatin-2026-10-13.ts

const STUDIO = 'retro'
const fold = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ı/g, 'i').replace(/İ/g, 'i').toLowerCase().trim()
const ms = (v: unknown): number => (v instanceof Timestamp ? v.toMillis() : Number(v ?? 0))
const an = (v: unknown): string => (ms(v) ? new Date(ms(v)).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' }) : '—')

async function main(): Promise<void> {
  initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID ?? 'studio-yonetim-prod' })
  const col = (n: string) => getFirestore().collection(`studios/${STUDIO}/${n}`)
  const uyeler = await col('members').get()
  const bulunan = uyeler.docs.filter((d) => { const n = fold(String(d.get('fullName') ?? '')); return n.includes('gamze') && n.includes('pilat') })
  console.log(`━━ eşleşme: ${bulunan.map((d) => `${d.get('fullName')} (${d.id})`).join(' · ') || 'YOK'}`)
  if (bulunan.length !== 1) { console.log('gamze içerenler:', uyeler.docs.filter((d) => fold(String(d.get('fullName') ?? '')).includes('gamze')).map((d) => d.get('fullName')).join(' · ')); return }
  const M = bulunan[0]!.id
  const [paketler, rezler, olaylar] = await Promise.all([
    col('entitlements').where('memberId', '==', M).get(),
    col('reservations').where('memberId', '==', M).get(),
    col('events').where('related.memberId', '==', M).get(),
  ])
  console.log(`\n━━ PAKETLER (${paketler.size})`)
  for (const e of paketler.docs.sort((a, b) => ms(a.get('validFrom')) - ms(b.get('validFrom')))) {
    console.log(`   ${e.id} · ${e.get('productSnapshot.name')} · ${e.get('status')} · ${e.get('productSnapshot.category')}\n       ${an(e.get('validFrom'))} → ${an(e.get('validUntil'))} · krediler=${JSON.stringify(e.get('credits'))} · giriş=${e.get('productSnapshot.entryAllowance') ?? '-'}/${JSON.stringify(e.get('entryLedger'))} · fiyat=${JSON.stringify(e.get('priceAgreed'))} ödenen=${JSON.stringify(e.get('paidTotal'))} · freeze=${JSON.stringify(e.get('freeze'))}`)
  }
  const son = Date.now() - 50 * 86_400_000
  console.log('\n━━ REZERVASYONLAR, son 50 gün + gelecek')
  for (const r of rezler.docs.filter((r) => ms(r.get('sessionStartsAt')) >= son).sort((a, b) => ms(a.get('sessionStartsAt')) - ms(b.get('sessionStartsAt'))))
    console.log(`   ${an(r.get('sessionStartsAt'))} · ${String(r.get('status')).padEnd(12)} · ${r.get('entitlementId')}`)
  console.log('\n━━ PAKET OLAYLARI, son 50 gün')
  for (const o of olaylar.docs.filter((o) => /^entitlement\./.test(String(o.get('type'))) && !/expiring|credits_low/.test(String(o.get('type'))) && ms(o.get('occurredAt')) >= son).sort((a, b) => a.id.localeCompare(b.id)))
    console.log(`   ${an(o.get('occurredAt'))} · ${String(o.get('type')).padEnd(28)} · ${o.get('actor.type')} · ${JSON.stringify(o.get('payload')).slice(0, 220)}`)
  console.log('\n(salt okunur — hiçbir şey yazılmadı)')
}
main().catch((e) => { console.error(e); process.exit(1) })
