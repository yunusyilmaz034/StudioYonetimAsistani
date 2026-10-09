import { initializeApp } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'

// FATMA AKGÜNEŞ — GİRİŞLER: TANI (owner, 2026-10-09)
//
//   pnpm tsx tools/migration/tani-fatma-akgunes-2026-10-09.ts
//
// SALT OKUNUR. Owner: *"Fatma Akgüneş girişlerini kontrol eder misin."*
// Ölçülecek: paketleri, kapı olayları (giriş, çıkış, RET ve sebebi), ve girişlerine denk gelen dersler.

const STUDIO = 'retro'
const ARANAN = 'fatma akgunes'
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
    const k = uyeler.docs.filter((d) => fold(String(d.get('fullName') ?? '')).includes('akgunes'))
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
    const c = e.get('credits') as Record<string, number> | null
    const kalan = c ? c.granted + c.restored - c.consumed - c.held - c.revoked - c.expired : null
    console.log(
      `   ${e.get('productSnapshot.name')} · ${e.get('status')} · kategori=${e.get('productSnapshot.category')}\n` +
      `       ${an(e.get('validFrom'))} → ${an(e.get('validUntil'))}` +
      (c ? ` · kalan ${kalan} (tutulan ${c.held}, harcanan ${c.consumed}, yanan ${c.expired})` : ' · süreli') +
      ` · giriş hakkı=${JSON.stringify(e.get('productSnapshot.entryAllowance') ?? null)} · giriş defteri=${JSON.stringify(e.get('entryLedger') ?? null)}`,
    )
  }

  const son = Date.now() - 30 * 86_400_000
  console.log(`\n━━ REZERVASYONLAR, son 30 gün + gelecek`)
  for (const r of rezler.docs.filter((r) => ms(r.get('sessionStartsAt')) >= son).sort((a, b) => ms(a.get('sessionStartsAt')) - ms(b.get('sessionStartsAt')))) {
    console.log(`   ${an(r.get('sessionStartsAt'))} · ${String(r.get('status')).padEnd(14)} · yazıldı ${an(r.get('bookedAt'))}`)
  }

  const kapi = olaylar.docs
    .filter((o) => /^(member\.(checked|entry|exited)|turnstile\.|entitlement\.entry_)/.test(String(o.get('type'))) && ms(o.get('occurredAt')) >= son)
    .sort((a, b) => a.id.localeCompare(b.id))
  console.log(`\n━━ KAPI OLAYLARI, son 30 gün (${kapi.length})`)
  for (const o of kapi) {
    console.log(`   ${an(o.get('occurredAt'))} · ${String(o.get('type')).padEnd(30)} · ${String(o.get('actor.type')).padEnd(14)} · ${JSON.stringify(o.get('payload') ?? {})}`)
  }
  console.log(`\n━━ ŞU AN: ${icerde.exists ? `İÇERİDE (giriş ${an(icerde.get('checkedInAt'))})` : 'içeride değil'}`)
  console.log('\n(salt okunur — hiçbir şey yazılmadı)')
}

main().catch((e) => { console.error(e); process.exit(1) })
