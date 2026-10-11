import { initializeApp } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'

// İLKİM İREM GENÇ — HİBRİT 2 AYLIK 1 AY YAZILMIŞ: TANI (owner, 2026-10-11)
//
//   pnpm tsx tools/migration/tani-ilkim-irem-genc-2026-10-11.ts
//
// SALT OKUNUR. Owner: *"hibrit 2 aylık verilmiş ama 1 ay süre eklenmiş."*
// Ölçülecek: paketleri, kapı olayları (giriş, çıkış, RET ve sebebi), ve girişlerine denk gelen dersler.

const STUDIO = 'retro'
const ARANAN = 'ilkim irem genc'
const fold = (s: string): string =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ı/g, 'i').replace(/İ/g, 'i').toLowerCase().trim()
const ms = (v: unknown): number => (v instanceof Timestamp ? v.toMillis() : Number(v ?? 0))
const an = (v: unknown): string => {
  const t = ms(v)
  return t ? new Date(t).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' }) : '—'
}

async function main(): Promise<void> {
  initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID ?? 'studio-yonetim-prod' })
  const db = getFirestore()
  const col = (n: string) => db.collection(`studios/${STUDIO}/${n}`)

  const uyeler = await col('members').get()
  const bulunan = uyeler.docs.filter((d) => fold(String(d.get('fullName') ?? '')).includes(ARANAN))
  console.log(`━━ ÜYE "${ARANAN}" → ${bulunan.length} eşleşme (${uyeler.size} tarandı)`)
  if (bulunan.length !== 1) {
    const k = uyeler.docs.filter((d) => fold(String(d.get('fullName') ?? '')).includes('ilkim'))
    console.log(`   "akgunes" içerenler: ${k.map((d) => `${d.get('fullName')} (${d.id})`).join(' · ') || 'yok'}`)
    process.exit(1)
  }
  const M = bulunan[0]!.id
  console.log(`   ${bulunan[0]!.get('fullName')} · ${M}`)

  const [paketler, rezler, olaylar, icerde] = await Promise.all([
    col('entitlements').where('memberId', '==', M).get(),
    col('reservations').where('memberId', '==', M).get(),
    col('events').where('related.memberId', '==', M).get(),
    col('presence').doc(M).get(),
  ])

  console.log(`\n━━ PAKETLER (${paketler.size})`)
  for (const e of paketler.docs.sort((a, b) => ms(a.get('validFrom')) - ms(b.get('validFrom')))) {
    const c = e.get('credits') as { granted: number; restored: number; consumed: number; held: number; revoked: number; expired: number } | null
    const kalan = c ? c.granted + c.restored - c.consumed - c.held - c.revoked - c.expired : null
    console.log(
      `   ${e.get('productSnapshot.name')} · ${e.get('status')} · kategori=${e.get('productSnapshot.category')}\n` +
      `       ${an(e.get('validFrom'))} → ${an(e.get('validUntil'))}` +
      (c ? ` · kalan ${kalan} (tutulan ${c.held}, harcanan ${c.consumed}, yanan ${c.expired})` : ' · süreli') +
      ` · giriş hakkı=${JSON.stringify(e.get('productSnapshot.entryAllowance') ?? null)} · giriş defteri=${JSON.stringify(e.get('entryLedger') ?? null)}`,
    )
  }

  console.log('\n━━ PAKET BELGELERİ (ham)')
  for (const e of paketler.docs) {
    const d = e.data()
    console.log(`   ${e.id} · bundle=${JSON.stringify(d.bundle ?? d.bundleId ?? d.saleId ?? null)} · purchasedAt=${an(d.purchasedAt)} · priceAgreed=${d.priceAgreed} paidTotal=${d.paidTotal}\n       snapshot=${JSON.stringify(d.productSnapshot)}\n       credits=${JSON.stringify(d.credits)} entryLedger=${JSON.stringify(d.entryLedger)} freeze=${JSON.stringify(d.freeze)}`)
  }
  const urunler = await col('products').get()
  console.log('\n━━ KATALOG — hibrit ürünler')
  for (const u of urunler.docs.filter((u) => fold(String(u.get('name') ?? '')).includes('hibrit'))) {
    console.log(`   ${u.id} · ${u.get('name')} · aktif=${u.get('active')} · ${JSON.stringify({ grant: u.get('grant'), bundle: u.get('bundle') ?? u.get('components') ?? null, entryAllowance: u.get('entryAllowance') ?? null, listPrice: u.get('listPrice') })}`)
  }

  const son = Date.now() - 75 * 86_400_000
  console.log(`\n━━ REZERVASYONLAR, son 75 gün + gelecek`)
  for (const r of rezler.docs.filter((r) => ms(r.get('sessionStartsAt')) >= son).sort((a, b) => ms(a.get('sessionStartsAt')) - ms(b.get('sessionStartsAt')))) {
    console.log(`   ${an(r.get('sessionStartsAt'))} · ${String(r.get('status')).padEnd(14)} · yazıldı ${an(r.get('bookedAt'))}`)
  }

  const kapi = olaylar.docs
    .filter((o) => /^(member\.(checked|entry|exited)|turnstile\.|entitlement\.|reservation\.|payment\.)/.test(String(o.get('type'))) && ms(o.get('occurredAt')) >= son)
    .sort((a, b) => a.id.localeCompare(b.id))
  console.log(`\n━━ KAPI OLAYLARI, son 75 gün (${kapi.length})`)
  for (const o of kapi) {
    console.log(`   ${an(o.get('occurredAt'))} · ${String(o.get('type')).padEnd(30)} · ${String(o.get('actor.type')).padEnd(14)} · ${JSON.stringify(o.get('payload') ?? {})}`)
  }
  console.log(`\n━━ ŞU AN: ${icerde.exists ? `İÇERİDE (giriş ${an(icerde.get('checkedInAt'))})` : 'içeride değil'}`)
  console.log('\n(salt okunur — hiçbir şey yazılmadı)')
}

main().catch((e) => { console.error(e); process.exit(1) })
