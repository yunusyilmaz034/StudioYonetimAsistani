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

// PANO: GERİYE TARİHLİ ÖDEME, PARANIN GELDİĞİ GÜNE (owner, 2026-10-14)
//
//   pnpm tsx tools/migration/fix-pano-geriye-tarihli-odemeler-2026-10-14.ts            # kuru çalışma
//   pnpm tsx tools/migration/fix-pano-geriye-tarihli-odemeler-2026-10-14.ts --apply    # yaz
//
// Owner, Seher Yıldız düzeltmesinden sonra: *"burada kasaya giren hesaplaması yanlış oldu."* Pano bugün
// 48.550 ₺ diyordu, gerçek 28.550 ₺: 22.09 / 08.10 / 13.10 tarihli üç nakit ödeme (20.000 ₺) BUGÜN
// girildiği için bugüne sayılmıştı. Projektör `payment.received`i olayın gününe yazıyordu; olayda
// `receivedAt` yoktu. Artık var (bundan sonraki her ödeme kendi gününe gider).
//
// Eski olaylar değişmez. Girildiği gün ≠ paranın geldiği gün olan her ödeme için ödemenin KENDİ
// `receivedAt`i `settings/projection.paymentReceivedAt` tablosuna yazılır; rebuild ve verify oradan okur.
// Günler projektörün kendisiyle iki kez (tablosuz/tablolu) katlanıp FARKI yazılır — tutar ezbere değil.
// İki yazım, ikisi de OKUMA MODELİ / AYAR: olay, ödeme, kasa yok. Para üretilmez: günlerin toplamı sıfır.
//
// İkinci çalıştırma no-op: tabloda olan ödeme atlanır.

const STUDIO = 'retro' as StudioId
const APPLY = process.argv.includes('--apply')
const tl = (k: number) => `${(k / 100).toLocaleString('tr-TR')} ₺`

async function main(): Promise<void> {
  initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID ?? 'studio-yonetim-prod' })
  const db = getFirestore()
  const ayar = db.doc(`studios/${STUDIO}/settings/projection`)
  const [olaylar, ayarSnap, excluded] = await Promise.all([
    db.collection(`studios/${STUDIO}/events`).where('type', '==', 'payment.received').get(),
    ayar.get(),
    loadExcludedMemberIds(db, STUDIO),
  ])
  const mevcut = (ayarSnap.data()?.paymentReceivedAt ?? {}) as Record<string, number>
  const tablo: Record<string, number> = {}
  const gunler = new Map<string, number>()
  let alanli = 0

  for (const o of olaylar.docs.sort((a, b) => a.id.localeCompare(b.id))) {
    const payload = (o.get('payload') ?? {}) as Record<string, unknown>
    if (typeof payload.receivedAt === 'number') { alanli++; continue }
    const paymentId = String(o.get('related.paymentId') ?? '')
    if (!paymentId || paymentId in mevcut) continue
    const odeme = await db.doc(`studios/${STUDIO}/payments/${paymentId}`).get()
    const alindi = odeme.get('receivedAt')
    if (!(alindi instanceof Timestamp)) continue
    const olay = {
      type: 'payment.received',
      occurredAt: instant((o.get('occurredAt') as Timestamp).toMillis()),
      payload,
      memberId: (o.get('related.memberId') as string | undefined) ?? null,
      paymentId,
    }
    const fold = (t: ReadonlyMap<string, number>) => {
      const m = new Map<string, number>()
      for (const h of incrementTargets(projectDaily(olay, DEFAULT_STUDIO_CONFIG.utcOffsetMinutes, excluded, new Map(), new Map(), t), 0))
        m.set(h.inc.date, (m.get(h.inc.date) ?? 0) + (h.inc.counters.collectedKurus ?? 0))
      return m
    }
    const once = fold(new Map())
    const sonra = fold(new Map([[paymentId, alindi.toMillis()]]))
    const fark = new Map<string, number>()
    for (const [g, k] of sonra) fark.set(g, (fark.get(g) ?? 0) + k)
    for (const [g, k] of once) fark.set(g, (fark.get(g) ?? 0) - k)
    const degisen = [...fark].filter(([, k]) => k !== 0)
    if (degisen.length === 0) continue // aynı gün girilmiş — tabloya gerek yok
    tablo[paymentId] = alindi.toMillis()
    for (const [g, k] of degisen) gunler.set(g, (gunler.get(g) ?? 0) + k)
    const uye = String((await db.doc(`studios/${STUDIO}/members/${olay.memberId}`).get()).get('fullName') ?? '?')
    console.log(`   ${paymentId} · ${uye.padEnd(24)} · ${tl(Number((payload.amount as { amount: number }).amount)).padStart(10)} ${String(payload.method).padEnd(12)} · ${degisen.map(([g, k]) => `${g} ${k > 0 ? '+' : ''}${tl(k)}`).join(' · ')}${odeme.get('voided') ? ' · (sonradan iptal)' : ''}`)
  }

  const degisenGunler = [...gunler].filter(([, k]) => k !== 0).sort()
  console.log(`\n━━ ${olaylar.size} ödeme olayı · alanı olan ${alanli} · tabloya girecek ${Object.keys(tablo).length}`)
  console.log(`━━ DEĞİŞECEK GÜNLER (${degisenGunler.length}) — tahsilat`)
  for (const [g, k] of degisenGunler) console.log(`   ${g}  ${k > 0 ? '+' : ''}${tl(k)}`)
  const toplam = degisenGunler.reduce((n, [, k]) => n + k, 0)
  if (toplam !== 0) { console.error(`DUR: günlerin toplamı sıfır değil (${toplam}) — para taşınmalı, üretilmemeli.`); process.exit(1) }
  if (Object.keys(tablo).length === 0) { console.log('\nYapılacak bir şey yok.'); return }
  if (!APPLY) { console.log('\n── KURU ÇALIŞMA ── --apply ile çalıştır.'); return }

  // Tek işlem: tablo ile günler birlikte, yoksa rebuild ile kayıt ayrışırdı.
  const batch = db.batch()
  batch.set(ayar, { paymentReceivedAt: tablo }, { merge: true })
  for (const [g, k] of degisenGunler)
    batch.set(db.doc(`studios/${STUDIO}/readModels/daily/days/${g}`), { collectedKurus: FieldValue.increment(k) }, { merge: true })
  await batch.commit()
  console.log('\n✅ UYGULANDI')
}

main().catch((e) => { console.error(e); process.exit(1) })
