import {
  DEFAULT_STUDIO_CONFIG,
  incrementTargets,
  instant,
  loadExcludedMemberIds,
  projectDaily,
  type StudioId,
} from '@studio/core'
import { initializeApp } from 'firebase-admin/app'
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore'

// PANO: ESKİ İPTALLER DE ALINDIKLARI GÜNDEN DÜŞSÜN (owner, 2026-10-08 · OR-120)
//
//   pnpm tsx tools/migration/fix-pano-eski-iptaller-2026-10-08.ts            # kuru çalışma
//   pnpm tsx tools/migration/fix-pano-eski-iptaller-2026-10-08.ts --apply    # yaz
//
// Owner, deploy'dan sonra: *"bu ne, yine eksi diyor ya, hani düzeltmiştin."* Pano "bugün −9.500 ₺"
// diyordu: bugünün 12.000 ₺ tahsilatı, eksi DÜNÜN iki iptali (21.500 ₺). Yeni kural yalnızca bundan
// sonraki iptalleri doğru güne yazıyordu — o ikisi alan eklenmeden dakikalar önce yazılmıştı.
//
// Olay değiştirilmez. Eksik gün, ödemenin KENDİ `receivedAt`i; onu `settings/projection.voidReceivedAt`
// tablosuna (ödeme → alındığı an) yazıyoruz ve projektör oradan okuyor. Rebuild ve verify aynı tabloyu
// okuduğu için bu düzeltme bir sonraki rebuild'de geri gelmez.
//
// İKİ YAZIM, ikisi de OKUMA MODELİ / AYAR — olay, ödeme, kasa yok:
//   1) tablo: alanı olmayan her `payment.voided` için ödemenin alındığı an
//   2) günler: her iptalin eksisi iptal gününden alınıp alındığı güne taşınır
// Taşınacak tutar ezbere değil, projektörün KENDİSİNDEN: aynı olay tablosuz ve tablolu iki kez
// katlanır, fark yazılır. Test hesapları ve aynı gün iptaller böylece kendiliğinden elenir.
//
// İkinci çalıştırma no-op: tabloda zaten olan ödeme atlanır.

const STUDIO = 'retro' as StudioId
const APPLY = process.argv.includes('--apply')
const tl = (k: number) => `${(k / 100).toLocaleString('tr-TR')} ₺`

async function main(): Promise<void> {
  initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID ?? 'studio-yonetim-prod' })
  const db = getFirestore()
  const ayar = db.doc(`studios/${STUDIO}/settings/projection`)
  const [iptaller, ayarSnap, excluded] = await Promise.all([
    db.collection(`studios/${STUDIO}/events`).where('type', '==', 'payment.voided').get(),
    ayar.get(),
    loadExcludedMemberIds(db, STUDIO),
  ])
  const mevcut = (ayarSnap.data()?.voidReceivedAt ?? {}) as Record<string, number>

  const tablo: Record<string, number> = {}
  const gunler = new Map<string, number>()
  let alanli = 0
  let odemesiz = 0
  for (const o of iptaller.docs.sort((a, b) => a.id.localeCompare(b.id))) {
    const payload = (o.get('payload') ?? {}) as Record<string, unknown>
    if (typeof payload.receivedAt === 'number') { alanli++; continue }
    const paymentId = String(o.get('related.paymentId') ?? '')
    if (!paymentId || paymentId in mevcut) continue
    const odeme = await db.doc(`studios/${STUDIO}/payments/${paymentId}`).get()
    const alindi = odeme.get('receivedAt')
    if (!(alindi instanceof Timestamp)) { odemesiz++; continue }

    const olay = {
      type: 'payment.voided',
      occurredAt: instant((o.get('occurredAt') as Timestamp).toMillis()),
      payload,
      memberId: (o.get('related.memberId') as string | undefined) ?? null,
      paymentId,
    }
    const fold = (t: ReadonlyMap<string, number>) => {
      const m = new Map<string, number>()
      for (const h of incrementTargets(projectDaily(olay, DEFAULT_STUDIO_CONFIG.utcOffsetMinutes, excluded, t), 0))
        m.set(h.inc.date, (m.get(h.inc.date) ?? 0) + (h.inc.counters.collectedKurus ?? 0))
      return m
    }
    const once = fold(new Map())
    const sonra = fold(new Map([[paymentId, alindi.toMillis()]]))
    tablo[paymentId] = alindi.toMillis()
    const fark = new Map<string, number>()
    for (const [g, k] of sonra) fark.set(g, (fark.get(g) ?? 0) + k)
    for (const [g, k] of once) fark.set(g, (fark.get(g) ?? 0) - k)
    const degisen = [...fark].filter(([, k]) => k !== 0)
    for (const [g, k] of degisen) gunler.set(g, (gunler.get(g) ?? 0) + k)
    if (degisen.length > 0) console.log(`   ${paymentId} · ${tl(Number((payload.amount as { amount: number }).amount))} · ${degisen.map(([g, k]) => `${g} ${k > 0 ? '+' : ''}${tl(k)}`).join(' · ')}`)
  }

  const degisenGunler = [...gunler].filter(([, k]) => k !== 0).sort()
  console.log(`\n━━ ${iptaller.size} iptal · alanı olan ${alanli} · tabloya girecek ${Object.keys(tablo).length} · ödemesi bulunamayan ${odemesiz}`)
  console.log(`━━ DEĞİŞECEK GÜNLER (${degisenGunler.length}) — tahsilat`)
  for (const [g, k] of degisenGunler) console.log(`   ${g}  ${k > 0 ? '+' : ''}${tl(k)}`)
  const toplam = degisenGunler.reduce((n, [, k]) => n + k, 0)
  if (toplam !== 0) { console.error(`DUR: günlerin toplamı sıfır değil (${toplam}) — para taşınmalı, üretilmemeli.`); process.exit(1) }

  if (Object.keys(tablo).length === 0) { console.log('\nYapılacak bir şey yok.'); return }
  if (!APPLY) { console.log('\n── KURU ÇALIŞMA ── --apply ile çalıştır.'); return }

  // Tek işlem: tablo ile günler birlikte yazılır, yoksa rebuild ile kayıt ayrışırdı.
  const batch = db.batch()
  batch.set(ayar, { voidReceivedAt: tablo }, { merge: true })
  for (const [g, k] of degisenGunler)
    batch.set(db.doc(`studios/${STUDIO}/readModels/daily/days/${g}`), { collectedKurus: FieldValue.increment(k) }, { merge: true })
  await batch.commit()
  console.log('\n✅ UYGULANDI')
}

main().catch((e) => { console.error(e); process.exit(1) })
