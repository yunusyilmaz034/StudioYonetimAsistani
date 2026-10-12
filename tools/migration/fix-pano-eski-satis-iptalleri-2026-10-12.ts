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

// PANO: ESKİ SATIŞ İPTALLERİ DE SATILDIKLARI GÜNDEN DÜŞSÜN (owner, 2026-10-12 · OR-122)
//
//   pnpm tsx tools/migration/fix-pano-eski-satis-iptalleri-2026-10-12.ts            # kuru çalışma
//   pnpm tsx tools/migration/fix-pano-eski-satis-iptalleri-2026-10-12.ts --apply    # yaz
//
// Owner: *"ücret alınmadıysa neden bugün eksiye düşüyor?"* — Hava Kolu'nun 16 Eylül'de satılıp hiç
// ödenmemiş 2.500 ₺'lik paketi 12 Ekim'de iptal edildi; pano "bugün −2.500 ₺" dedi. Yeni kural
// (`sale.cancelled.soldAt`) bundan sonraki iptalleri satış gününe yazıyor; bu betik, alan eklenmeden
// önce yazılmış iptalleri aynı yere taşır. `fix-pano-eski-iptaller-2026-10-08.ts`in satış karşılığı.
//
// Olay değiştirilmez. Eksik gün `settings/projection.saleSoldAt` tablosuna (satış → satıldığı an)
// yazılır; rebuild ve verify aynı tabloyu okur, yani düzeltme bir sonraki rebuild'de geri gelmez.
//
// "SATILDIĞI AN" = o satışın `sale.created` olayının anı — panonun satışı SAYDIĞI gün. Satış
// belgesindeki `soldAt` geriye dönük kurulmuş bir satışta bundan farklı olabilir; o zaman iptali
// belgenin gününe yazmak, hiç artı görmemiş bir günü eksiye düşürürdü. Fark varsa satır satır yazılır.
//
// İKİ YAZIM, ikisi de OKUMA MODELİ / AYAR — olay, satış, ödeme, kasa yok:
//   1) tablo: alanı olmayan her `sale.cancelled` için satışın sayıldığı an
//   2) günler: her iptalin eksisi iptal gününden alınıp satış gününe taşınır (yalnızca `salesKurus`)
// Taşınacak tutar projektörün KENDİSİNDEN: aynı olay tablosuz ve tablolu iki kez katlanır, fark yazılır.
// Test hesapları ve aynı gün iptaller böylece kendiliğinden elenir. İkinci çalıştırma no-op.

const STUDIO = 'retro' as StudioId
const APPLY = process.argv.includes('--apply')
const tl = (k: number) => `${(k / 100).toLocaleString('tr-TR')} ₺`
const gun = (ms: number) => new Date(ms).toLocaleDateString('sv-SE', { timeZone: 'Europe/Istanbul' })

async function main(): Promise<void> {
  initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID ?? 'studio-yonetim-prod' })
  const db = getFirestore()
  const ayar = db.doc(`studios/${STUDIO}/settings/projection`)
  const [iptaller, acilislar, ayarSnap, excluded] = await Promise.all([
    db.collection(`studios/${STUDIO}/events`).where('type', '==', 'sale.cancelled').get(),
    db.collection(`studios/${STUDIO}/events`).where('type', '==', 'sale.created').get(),
    ayar.get(),
    loadExcludedMemberIds(db, STUDIO),
  ])
  const mevcut = (ayarSnap.data()?.saleSoldAt ?? {}) as Record<string, number>
  const sayildi = new Map<string, number>()
  for (const o of acilislar.docs) {
    const id = String(o.get('subject.id') ?? '')
    if (id) sayildi.set(id, (o.get('occurredAt') as Timestamp).toMillis())
  }

  const tablo: Record<string, number> = {}
  const gunler = new Map<string, number>()
  let alanli = 0
  let acilissiz = 0
  for (const o of iptaller.docs.sort((a, b) => a.id.localeCompare(b.id))) {
    const payload = (o.get('payload') ?? {}) as Record<string, unknown>
    if (typeof payload.soldAt === 'number') { alanli++; continue }
    const saleId = String(o.get('subject.id') ?? '')
    if (!saleId || saleId in mevcut) continue
    const satildi = sayildi.get(saleId)
    if (satildi === undefined) { acilissiz++; console.log(`   ? ${saleId} — sale.created olayı yok, yerinde bırakıldı`); continue }

    const belge = await db.doc(`studios/${STUDIO}/sales/${saleId}`).get()
    const belgeAni = belge.get('soldAt')
    const belgeGunu = belgeAni instanceof Timestamp ? gun(belgeAni.toMillis()) : typeof belgeAni === 'number' ? gun(belgeAni) : null
    if (belgeGunu && belgeGunu !== gun(satildi)) console.log(`   ! ${saleId} — belge ${belgeGunu}, pano ${gun(satildi)} gününe saymış; pano günü kullanıldı`)

    const olay = {
      type: 'sale.cancelled',
      occurredAt: instant((o.get('occurredAt') as Timestamp).toMillis()),
      payload,
      memberId: (o.get('related.memberId') as string | undefined) ?? null,
      subjectId: saleId,
    }
    const fold = (t: ReadonlyMap<string, number>) => {
      const m = new Map<string, number>()
      for (const h of incrementTargets(projectDaily(olay, DEFAULT_STUDIO_CONFIG.utcOffsetMinutes, excluded, new Map(), t), 0))
        m.set(h.inc.date, (m.get(h.inc.date) ?? 0) + (h.inc.counters.salesKurus ?? 0))
      return m
    }
    const once = fold(new Map())
    const sonra = fold(new Map([[saleId, satildi]]))
    tablo[saleId] = satildi
    const fark = new Map<string, number>()
    for (const [g, k] of sonra) fark.set(g, (fark.get(g) ?? 0) + k)
    for (const [g, k] of once) fark.set(g, (fark.get(g) ?? 0) - k)
    const degisen = [...fark].filter(([, k]) => k !== 0)
    for (const [g, k] of degisen) gunler.set(g, (gunler.get(g) ?? 0) + k)
    if (degisen.length > 0) console.log(`   ${saleId} · ${tl(Number((payload.total as { amount: number }).amount))} · ${degisen.map(([g, k]) => `${g} ${k > 0 ? '+' : ''}${tl(k)}`).join(' · ')}`)
  }

  const degisenGunler = [...gunler].filter(([, k]) => k !== 0).sort()
  console.log(`\n━━ ${iptaller.size} satış iptali · alanı olan ${alanli} · tabloya girecek ${Object.keys(tablo).length} · açılışı bulunamayan ${acilissiz}`)
  console.log(`━━ DEĞİŞECEK GÜNLER (${degisenGunler.length}) — satış`)
  for (const [g, k] of degisenGunler) console.log(`   ${g}  ${k > 0 ? '+' : ''}${tl(k)}`)
  const toplam = degisenGunler.reduce((n, [, k]) => n + k, 0)
  if (toplam !== 0) { console.error(`DUR: günlerin toplamı sıfır değil (${toplam}) — satış taşınmalı, üretilmemeli.`); process.exit(1) }

  if (Object.keys(tablo).length === 0) { console.log('\nYapılacak bir şey yok.'); return }
  if (!APPLY) { console.log('\n── KURU ÇALIŞMA ── --apply ile çalıştır.'); return }

  // Tek işlem: tablo ile günler birlikte yazılır, yoksa rebuild ile kayıt ayrışırdı.
  const batch = db.batch()
  batch.set(ayar, { saleSoldAt: tablo }, { merge: true })
  for (const [g, k] of degisenGunler)
    batch.set(db.doc(`studios/${STUDIO}/readModels/daily/days/${g}`), { salesKurus: FieldValue.increment(k) }, { merge: true })
  await batch.commit()
  console.log('\n✅ UYGULANDI')
}

main().catch((e) => { console.error(e); process.exit(1) })
