import { initializeApp } from 'firebase-admin/app'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'

// PANO: SONRADAN GİRİLEN SATIŞ, SATILDIĞI GÜNE (owner, 2026-11-20: "anlaşılan tutar ile kasa yine gitti").
//
//   pnpm tsx tools/migration/fix-pano-geriye-satislar-2026-11-20.ts [--apply]
//
// `sale.created` satışın girildiği güne sayılıyordu; tahsilat ise `receivedAt` ile kendi gününe. Geriye tarihli dört
// satış (Melike 10.11, PayTR eşleştirmeleri 17.11 ×2, Naz Aytekin 30.10) panoda yanlış günde. Projektör artık
// `settings/projection.saleSoldAt` tablosundaki anı kullanıyor (daily.ts). Bu betik:
//   1) tabloya her satış için belgedeki `soldAt`'ı yazar (rebuild/verify aynı tabloyu okur)
//   2) okuma modelinde `salesKurus`'u girildiği günden satıldığı güne taşır.
// Olay, satış, ödeme, kasa değişmez. Tablo satırı zaten varsa o satış atlanır (ikinci çalıştırma no-op).

const STUDIO = 'retro'
const SATISLAR = [
  'sal_01M75WEM4DAYAZ3EF1AKCPHGKE',
  'sal_01M7QJTCE15S9K71QQ449F52D3',
  'sal_01M7QJZBTJ09K7RY6CP15PKGCW',
  'sal_01M7WNRZYN3SHAHP3C1C77MFWA',
]
const ms = (x: unknown): number => (typeof (x as { toMillis?: unknown })?.toMillis === "function" ? (x as { toMillis: () => number }).toMillis() : Number(x))
const gun = (m: number) => new Date(m).toLocaleDateString('sv-SE', { timeZone: 'Europe/Istanbul' })

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply')
  initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID ?? 'studio-yonetim-prod' })
  const db = getFirestore()
  const ayar = db.doc(`studios/${STUDIO}/settings/projection`)
  const mevcut = ((await ayar.get()).get('saleSoldAt') ?? {}) as Record<string, number>
  const days = (d: string) => db.doc(`studios/${STUDIO}/readModels/daily/days/${d}`)
  console.log(apply ? '── UYGULANIYOR ──' : '── KURU ÇALIŞMA ──')
  for (const id of SATISLAR) {
    if (mevcut[id] != null) { console.log(`${id}: tabloda zaten var, atlandı`); continue }
    const sale = (await db.doc(`studios/${STUDIO}/sales/${id}`).get()).data()
    const ev = (await db.collection(`studios/${STUDIO}/events`).where('subject.id', '==', id).where('type', '==', 'sale.created').get()).docs[0]
    if (!sale || !ev) { console.error(`DUR: ${id} bulunamadı`); process.exit(1) }
    const soldAt = ms(sale.soldAt)
    const from = gun(ms(ev.get('occurredAt')))
    const to = gun(soldAt)
    const total = Number(ev.get('payload.total.amount'))
    if (!(to < from)) { console.log(`${id}: satış günü ileri/aynı, atlandı`); continue }
    console.log(`${id}: ${(total / 100).toLocaleString('tr-TR')} ₺  ${from} → ${to}`)
    if (!apply) continue
    const b = db.batch()
    b.set(ayar, { saleSoldAt: { [id]: soldAt } }, { merge: true })
    b.set(days(from), { salesKurus: FieldValue.increment(-total) }, { merge: true })
    b.set(days(to), { salesKurus: FieldValue.increment(total) }, { merge: true })
    await b.commit()
    console.log('  ✅')
  }
  process.exit(0)
}
void main().catch((e) => { console.error(e); process.exit(1) })
