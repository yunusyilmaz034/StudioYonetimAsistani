import { initializeApp } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'

// ARZU DOĞAN — "12 aylık → kendisine 6 aylık + kızına 6 aylık, farkı ödeyecek" (Işıl → owner, 2026-10-19).
// SALT OKUNUR.
//
//   pnpm tsx tools/migration/tani-arzu-dogan-2026-10-19.ts

const STUDIO = 'retro'
const fold = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ı/g, 'i').replace(/İ/g, 'i').toLowerCase().trim()
const ms = (v: unknown): number => (v instanceof Timestamp ? v.toMillis() : Number(v ?? 0))
const an = (v: unknown): string => (ms(v) ? new Date(ms(v)).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' }) : '—')
const tl = (m: unknown): string => {
  const k = typeof m === 'object' && m !== null ? Number((m as { amount?: number }).amount ?? 0) : Number(m ?? 0)
  return `${(k / 100).toLocaleString('tr-TR')} ₺`
}

async function main(): Promise<void> {
  initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID ?? 'studio-yonetim-prod' })
  const col = (n: string) => getFirestore().collection(`studios/${STUDIO}/${n}`)
  const uyeler = await col('members').get()
  const bulunan = uyeler.docs.filter((d) => { const n = fold(String(d.get('fullName') ?? '')); return n.includes('arzu') && n.includes('dogan') })
  console.log(`━━ eşleşme: ${bulunan.map((d) => `${d.get('fullName')} (${d.id})`).join(' · ') || 'YOK'}`)
  if (bulunan.length !== 1) { console.log('doğan içerenler:', uyeler.docs.filter((d) => fold(String(d.get('fullName') ?? '')).includes('dogan')).map((d) => d.get('fullName')).join(' · ')); return }
  const M = bulunan[0]!.id
  const [paketler, odemeler, satislar, olaylar] = await Promise.all([
    col('entitlements').where('memberId', '==', M).get(),
    col('payments').where('memberId', '==', M).get(),
    col('sales').where('memberId', '==', M).get(),
    col('events').where('related.memberId', '==', M).get(),
  ])
  console.log(`\n━━ PAKETLER (${paketler.size})`)
  for (const e of paketler.docs.sort((a, b) => ms(a.get('purchasedAt')) - ms(b.get('purchasedAt'))))
    console.log(`   ${e.id} · ${e.get('productSnapshot.name')} · ${e.get('status')} · ${an(e.get('validFrom'))} → ${an(e.get('validUntil'))}\n       liste=${tl(e.get('productSnapshot.listPrice'))} anlaşılan=${tl(e.get('priceAgreed'))} ödenen=${tl(e.get('paidTotal'))} satış=${e.get('saleId') ?? '-'} alındı=${an(e.get('purchasedAt'))}`)
  console.log(`\n━━ SATIŞLAR (${satislar.size})`)
  for (const s of satislar.docs.sort((a, b) => ms(a.get('soldAt')) - ms(b.get('soldAt'))))
    console.log(`   ${s.id} · ${s.get('status')} · satıldı=${an(s.get('soldAt'))} · toplam=${tl(s.get('total'))} ödenen=${tl(s.get('paid'))} indirim=${JSON.stringify(s.get('discount') ?? null)} · ${JSON.stringify(s.get('lines') ?? s.get('items') ?? null).slice(0, 300)}`)
  console.log(`\n━━ ÖDEMELER (${odemeler.size})`)
  for (const p of odemeler.docs.sort((a, b) => ms(a.get('receivedAt')) - ms(b.get('receivedAt'))))
    console.log(`   ${p.id} · ${p.get('status') ?? ''} · alındı=${an(p.get('receivedAt'))} · ${tl(p.get('amount'))} · ${p.get('method')} · satış=${p.get('saleId') ?? '-'} · tahsisler=${JSON.stringify(p.get('allocations') ?? null).slice(0, 200)}`)
  console.log('\n━━ PARA OLAYLARI')
  for (const o of olaylar.docs.filter((o) => /^(sale|payment|entitlement\.(purchased|amended|price)|balance|discount)/.test(String(o.get('type')))).sort((a, b) => a.id.localeCompare(b.id)))
    console.log(`   ${an(o.get('occurredAt'))} · ${String(o.get('type')).padEnd(30)} · ${o.get('actor.type')} · ${JSON.stringify(o.get('payload')).slice(0, 260)}`)
  console.log('\n(salt okunur — hiçbir şey yazılmadı)')
}
main().catch((e) => { console.error(e); process.exit(1) })
