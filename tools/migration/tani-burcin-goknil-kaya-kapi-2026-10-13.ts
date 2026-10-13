import { initializeApp } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'

// BURÇİN GÖKNİL KAYA — "kapıda kaldı, uyarı geldi; paketi yok diye mi?" (owner, 2026-10-13). SALT OKUNUR.
//
//   pnpm tsx tools/migration/tani-burcin-goknil-kaya-kapi-2026-10-13.ts

const STUDIO = 'retro'
const M = 'mem_01KZRPWV6ZHAE5EE83AS43FEFJ'
const ms = (v: unknown): number => (v instanceof Timestamp ? v.toMillis() : Number(v ?? 0))
const an = (v: unknown): string => (ms(v) ? new Date(ms(v)).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' }) : '—')

async function main(): Promise<void> {
  initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID ?? 'studio-yonetim-prod' })
  const col = (n: string) => getFirestore().collection(`studios/${STUDIO}/${n}`)
  const [uye, paketler, rezler, olaylar] = await Promise.all([
    col('members').doc(M).get(),
    col('entitlements').where('memberId', '==', M).get(),
    col('reservations').where('memberId', '==', M).get(),
    col('events').where('related.memberId', '==', M).get(),
  ])
  console.log(`━━ ${uye.get('fullName')} · durum=${uye.get('status')} · kısıt=${JSON.stringify(uye.get('restriction') ?? null)}`)
  console.log(`\n━━ PAKETLER (${paketler.size})`)
  for (const e of paketler.docs.sort((a, b) => ms(a.get('validFrom')) - ms(b.get('validFrom')))) {
    console.log(`   ${e.id} · ${e.get('productSnapshot.name')} · ${e.get('status')} · ${e.get('productSnapshot.category')}\n       ${an(e.get('validFrom'))} → ${an(e.get('validUntil'))} · krediler=${JSON.stringify(e.get('credits'))} · giriş=${e.get('productSnapshot.entryAllowance') ?? '-'}/${JSON.stringify(e.get('entryLedger'))} · fiyat=${JSON.stringify(e.get('priceAgreed'))} ödenen=${JSON.stringify(e.get('paidTotal'))} · freeze=${JSON.stringify(e.get('freeze'))}`)
  }
  const son = Date.now() - 14 * 86_400_000
  console.log('\n━━ REZERVASYONLAR, son 14 gün + gelecek')
  for (const r of rezler.docs.filter((r) => ms(r.get('sessionStartsAt')) >= son).sort((a, b) => ms(a.get('sessionStartsAt')) - ms(b.get('sessionStartsAt'))))
    console.log(`   ${an(r.get('sessionStartsAt'))} · ${String(r.get('status')).padEnd(12)} · ${r.get('entitlementId')}`)
  console.log('\n━━ TÜM OLAYLAR, son 14 gün')
  for (const o of olaylar.docs.filter((o) => ms(o.get('occurredAt')) >= son).sort((a, b) => a.id.localeCompare(b.id)))
    console.log(`   ${an(o.get('occurredAt'))} · ${String(o.get('type')).padEnd(30)} · ${o.get('actor.type')} · ${JSON.stringify(o.get('payload')).slice(0, 260)}`)
  console.log('\n(salt okunur — hiçbir şey yazılmadı)')
}
main().catch((e) => { console.error(e); process.exit(1) })
