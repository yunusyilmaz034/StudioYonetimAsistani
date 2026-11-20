import { initializeApp } from 'firebase-admin/app'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'

// PANO: BUGÜN GİRİLEN İKİ İNDİRİM, SATIŞIN YAPILDIĞI GÜNE (owner, 2026-11-20: onay).
//
//   pnpm tsx tools/migration/fix-pano-indirim-satis-gunu-2026-11-20.ts [--apply]
//
// `soldAt` alanı gelmeden yazılmış `sale.discounted` olayları için satışın günü `settings/projection.saleSoldAt`
// tablosuna yazılır (projektör ve rebuild aynı tabloyu okur) ve indirimin eksisi okuma modelinde girildiği günden satış
// gününe taşınır. Olay/satış/ödeme değişmez. Bugünün (20.11) `soldAt`'sız indirimleri; tabloda olan satış atlanır.

const STUDIO = 'retro'
const GUN = '2026-11-20'
const msOf = (x: unknown): number => (typeof (x as { toMillis?: unknown })?.toMillis === 'function' ? (x as { toMillis: () => number }).toMillis() : Number(x))
const gun = (m: number) => new Date(m).toLocaleDateString('sv-SE', { timeZone: 'Europe/Istanbul' })

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply')
  initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID ?? 'studio-yonetim-prod' })
  const db = getFirestore()
  const ayar = db.doc(`studios/${STUDIO}/settings/projection`)
  const tablo = ((await ayar.get()).get('saleSoldAt') ?? {}) as Record<string, number>
  const day = (d: string) => db.doc(`studios/${STUDIO}/readModels/daily/days/${d}`)
  const ev = await db.collection(`studios/${STUDIO}/events`).where('type', 'in', ['sale.discounted', 'sale.discount_corrected']).get()
  console.log(apply ? '── UYGULANIYOR ──' : '── KURU ÇALIŞMA ──')
  for (const e of ev.docs) {
    const x = e.data()
    if (gun(msOf(x.occurredAt)) !== GUN || typeof x.payload?.soldAt === 'number') continue
    const saleId = String(x.subject?.id ?? '')
    if (tablo[saleId] != null) { console.log(`${saleId}: tabloda var, atlandı`); continue }
    const sale = (await db.doc(`studios/${STUDIO}/sales/${saleId}`).get()).data()
    if (!sale) { console.error(`DUR: ${saleId} yok`); process.exit(1) }
    const soldAt = msOf(sale.soldAt)
    const to = gun(soldAt)
    const delta = Number(x.payload.totalAfter.amount) - Number(x.payload.totalBefore.amount)
    if (!(to < GUN)) { console.log(`${saleId}: aynı gün, atlandı`); continue }
    console.log(`${saleId}: ${x.type} ${delta / 100} ₺  ${GUN} → ${to}`)
    if (!apply) continue
    const b = db.batch()
    b.set(ayar, { saleSoldAt: { [saleId]: soldAt } }, { merge: true })
    b.set(day(GUN), { salesKurus: FieldValue.increment(-delta) }, { merge: true })
    b.set(day(to), { salesKurus: FieldValue.increment(delta) }, { merge: true })
    await b.commit()
    tablo[saleId] = soldAt
  }
  process.exit(0)
}
void main().catch((e) => { console.error(e); process.exit(1) })
