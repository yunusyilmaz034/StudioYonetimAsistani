import { initializeApp } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'

// KASA EKSİYE DÜŞTÜ — TANI (owner, 2026-10-08)
//
//   pnpm tsx tools/migration/tani-kasa-eksi-2026-10-08.ts
//
// SALT OKUNUR. Hiçbir şey yazmaz.
//
// Owner: *"genel görünümde eksiye düştük; dün 2 ödeme yanlış kaydedilmişti, onları sildim. Dünden
// düşmüş tamam, bugünden de düşmüş — yanlış."*
//
// Ölçülecek: bugün iptal edilen ödemeler hangi günün, hangi kasanın; kasa dün sayılıp kapandı mı;
// panonun günlük okuma modeli ve kasanın `expected`i bu iptalleri hangi güne yazdı.

const STUDIO = 'retro'
const an = (v: unknown): string => {
  const ms = v instanceof Timestamp ? v.toMillis() : typeof v === 'number' ? v : NaN
  return Number.isNaN(ms) ? '—' : new Date(ms).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' })
}
const tl = (k: unknown) => `${(Number(k ?? 0) / 100).toLocaleString('tr-TR')} ₺`
const ms = (v: unknown): number => (v instanceof Timestamp ? v.toMillis() : Number(v ?? 0))

async function main(): Promise<void> {
  initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID ?? 'studio-yonetim-prod' })
  const db = getFirestore()
  const col = (n: string) => db.collection(`studios/${STUDIO}/${n}`)
  const basla = Date.parse('2026-10-07T00:00:00+03:00')

  const olaylar = (await col('events').where('occurredAt', '>=', Timestamp.fromMillis(basla)).get()).docs
    .concat((await col('events').where('occurredAt', '>=', basla).get()).docs)
  const para = olaylar
    .filter((o) => /^(payment|drawer|cash|expense|sale\.cancelled)/.test(String(o.get('type'))))
    .sort((a, b) => a.id.localeCompare(b.id))
  console.log(`━━ PARA OLAYLARI, 7 Ekim'den beri (${para.length})`)
  for (const o of para) {
    console.log(`   ${an(o.get('occurredAt'))} · ${String(o.get('type')).padEnd(26)} · ${o.get('actor.type')} · ödeme=${o.get('related.paymentId') ?? '—'}\n       ${JSON.stringify(o.get('payload') ?? {}).slice(0, 300)}`)
  }

  const iptaller = para.filter((o) => o.get('type') === 'payment.voided')
  console.log(`\n━━ İPTAL EDİLEN ÖDEMELER (${iptaller.length})`)
  for (const o of iptaller) {
    const p = await col('payments').doc(String(o.get('related.paymentId'))).get()
    console.log(
      `   ${p.id} · ${tl(p.get('amount.amount'))} · ${p.get('method')} · kasa=${p.get('drawerId') ?? '—'}\n` +
      `       alındı ${an(p.get('receivedAt'))} · iptal ${an(o.get('occurredAt'))} · sebep: ${p.get('voidReason')}`,
    )
  }

  console.log('\n━━ KASALAR')
  for (const d of (await col('drawers').get()).docs) {
    console.log(`   ${d.id}\n       ${JSON.stringify(d.data(), (_k, v) => (v instanceof Timestamp ? an(v) : v)).slice(0, 700)}`)
  }

  console.log('\n━━ GÜNLÜK OKUMA MODELİ')
  for (const c of await db.doc(`studios/${STUDIO}`).listCollections()) {
    if (!/daily|projection|readModel/i.test(c.id)) continue
    for (const g of ['2026-10-07', '2026-10-08']) {
      for (const d of (await c.get()).docs.filter((x) => x.id.includes(g))) {
        console.log(`   ${c.id}/${d.id} · tahsilat ${tl(d.get('collectedKurus'))} · satış ${tl(d.get('salesKurus'))}`)
      }
    }
  }

  const odemeler = (await col('payments').get()).docs.filter((p) => ms(p.get('receivedAt')) >= basla)
  console.log(`\n━━ 7 EKİM'DEN BERİ ÖDEME BELGELERİ (${odemeler.length})`)
  for (const p of odemeler.sort((a, b) => ms(a.get('receivedAt')) - ms(b.get('receivedAt')))) {
    console.log(`   ${an(p.get('receivedAt'))} · ${tl(p.get('amount.amount')).padStart(12)} · ${String(p.get('method')).padEnd(14)} · kasa=${p.get('drawerId') ?? '—'}${p.get('voided') ? ' · İPTAL' : ''}`)
  }
  console.log('\n(salt okunur — hiçbir şey yazılmadı)')
}

main().catch((e) => { console.error(e); process.exit(1) })
