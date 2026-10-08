import { initializeApp } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'

// DERS PAKETİYLE, DERSİ OLMADAN TURNİKEDEN GİRENLER — ÖLÇÜM (owner, 2026-10-08 · OR-121)
//
//   pnpm tsx tools/migration/tani-ders-paketiyle-serbest-giris-2026-10-08.ts
//
// SALT OKUNUR. Yeni kapı kuralı canlıya çıkınca KİM kapıda kalır? Son 14 günün turnike girişleri,
// yeni kuralla yeniden değerlendirilir: fitness paketi olmayan ve girişine denk gelen dersi
// (başlamasına ≤1 saat, bitmemiş) olmayan her giriş, yeni kuralda bir rettir.
//
// REZERVASYON, GİRİŞTEN ÖNCE YAZILMIŞ OLMALI. İlk ölçüm bunu sormadı ve 1 giriş buldu: masa, kapıdan
// geçmiş üyeyi SONRADAN derse yazıyor (Behice 11:45'te girdi, 12:50'de 12:00 dersine yazıldı) ve kayıt
// geriye dönük olarak kusursuz görünüyor. Kapı ise o an bakar.
//
// YAKLAŞIK: paketler BUGÜNKÜ hâlleriyle okunuyor (o günkü değil) — sayı bir büyüklük, kesin değil.

const STUDIO = 'retro'
const GUN = 14
const ms = (v: unknown): number => (v instanceof Timestamp ? v.toMillis() : Number(v ?? 0))
const an = (v: number) => new Date(v).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

async function main(): Promise<void> {
  initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID ?? 'studio-yonetim-prod' })
  const db = getFirestore()
  const col = (n: string) => db.collection(`studios/${STUDIO}/${n}`)
  const now = Date.now()
  const basla = now - GUN * 86_400_000

  const [girisler, paketler, rezler, uyeler] = await Promise.all([
    col('checkIns').where('occurredAt', '>=', Timestamp.fromMillis(basla)).get(),
    col('entitlements').get(),
    col('reservations').where('sessionStartsAt', '>=', Timestamp.fromMillis(basla - 4 * 3_600_000)).get(),
    col('members').get(),
  ])
  const ad = new Map(uyeler.docs.map((d) => [d.id, String(d.get('fullName') ?? '')]))
  // Paket, GİRİŞ ANINDA geçerli olmalı — sonradan dolmuş olması o günkü kapıyı değiştirmez.
  const paket = new Map<string, { fitness: boolean; from: number; until: number }[]>()
  for (const e of paketler.docs) {
    if (e.get('status') === 'cancelled') continue
    const k = String(e.get('memberId'))
    paket.set(k, [...(paket.get(k) ?? []), { fitness: e.get('productSnapshot.category') === 'fitness', from: ms(e.get('validFrom')), until: ms(e.get('validUntil')) }])
  }
  const dersler = new Map<string, { bas: number; bit: number; yazildi: number }[]>()
  for (const r of rezler.docs) {
    if (r.get('status') === 'cancelled') continue
    const k = String(r.get('memberId'))
    dersler.set(k, [...(dersler.get(k) ?? []), { bas: ms(r.get('sessionStartsAt')), bit: ms(r.get('sessionEndsAt')), yazildi: ms(r.get('bookedAt')) }])
  }

  let turnike = 0
  const kalan: { uye: string; at: number }[] = []
  for (const g of girisler.docs) {
    if (g.get('direction') !== 'in' || g.get('method') !== 'device') continue
    turnike++
    const uye = String(g.get('memberId'))
    const at = ms(g.get('occurredAt'))
    const gecerli = (paket.get(uye) ?? []).filter((p) => p.from <= at && at < p.until)
    if (gecerli.length === 0 || gecerli.some((p) => p.fitness)) continue
    const dersVar = (dersler.get(uye) ?? []).some((d) => d.bas <= at + 3_600_000 && d.bit >= at && d.yazildi <= at)
    if (!dersVar) kalan.push({ uye, at })
  }

  const sonradan = (uye: string, at: number) =>
    (dersler.get(uye) ?? []).some((d) => d.bas <= at + 3_600_000 && d.bit >= at && d.yazildi > at) ? ' [sonradan derse yazıldı]' : ''
  const kisi = new Map<string, number[]>()
  for (const k of kalan) kisi.set(k.uye, [...(kisi.get(k.uye) ?? []), k.at])
  console.log(`━━ SON ${GUN} GÜN · turnike girişi: ${turnike}`)
  console.log(`   yeni kuralda kapıda kalacak giriş: ${kalan.length} · ${kisi.size} farklı üye\n`)
  for (const [uye, atlar] of [...kisi].sort((a, b) => b[1].length - a[1].length)) {
    const enYakin = (at: number) => {
      const sonraki = (dersler.get(uye) ?? []).map((d) => d.bas - at).filter((f) => f > 3_600_000 && f < 12 * 3_600_000).sort((a, b) => a - b)[0]
      return sonraki ? ` (dersi ${Math.round(sonraki / 60_000)} dk sonra)` : ''
    }
    console.log(`   ${String(atlar.length).padStart(2)}× ${ad.get(uye) || uye} — ${atlar.sort().map((a) => an(a) + sonradan(uye, a) + enYakin(a)).join(' · ')}`)
  }
  console.log('\n(salt okunur — hiçbir şey yazılmadı)')
}

main().catch((e) => { console.error(e); process.exit(1) })
