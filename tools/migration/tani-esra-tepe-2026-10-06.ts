import {
  available,
  FirestoreEntitlementRepository,
  FirestoreReservationRepository,
  type Entitlement,
  type MemberId,
  type TenantContext,
} from '@studio/core'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'

// ESRA TEPE — 24 DERS İPTAL, 8 DERS KALACAK: TANI (owner, 2026-10-06)
//
//   pnpm tsx tools/migration/tani-esra-tepe-2026-10-06.ts
//
// SALT OKUNUR. Hiçbir şey yazmaz, `--apply` yoktur.
//
// Owner: *"esra tepe 24 ders almış önce sonra vazgeçmiş 8 ders almış şimdi 24 ders iptal olup 8 ders
// olacak ama bugüne kadar kullandığı kredileri geri vermiyoruz onları 8 dersten düşeceğiz, var olan
// rezervasyonlarını ellemeyeceğiz. Yani biz bu üyeden sadece 8 ders parası aldık ve 8 ders paketi
// satmışız, bize borçlu da değil alacaklı da değil."*
//
// ── ÖNCE ÖLÇÜLMESİ GEREKEN ŞEY ──────────────────────────────────────────────────────────────
//
// Mevcut rezervasyonları HANGİ paket ödüyor. 24'lük paketin üstündeyse onu iptal etmek
// rezervasyonları dayanaksız bırakır — owner'ın "ellemeyeceğiz" şartı tam olarak buna bağlı.
// Ayrıca: hangi kovada kaç kredi var, ne kadar para alındı, hangi ödeme hangi satışa yazıldı.

const STUDIO = 'retro'
const ARANAN = 'esra tepe'

const fold = (s: string): string =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ı/g, 'i').replace(/İ/g, 'i').toLowerCase().trim()
const tl = (k: unknown) => `${(Number(k ?? 0) / 100).toLocaleString('tr-TR')} ₺`
const an = (v: unknown): string =>
  v instanceof Timestamp ? v.toDate().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' })
  : typeof v === 'number' ? new Date(v).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' })
  : '—'
const kovalar = (e: Entitlement) =>
  e.credits
    ? `verilen ${e.credits.granted} · tutulan ${e.credits.held} · harcanan ${e.credits.consumed} · ` +
      `iade ${e.credits.restored} · geri alınan ${e.credits.revoked} · yanan ${e.credits.expired} → KALAN ${available(e.credits)}`
    : 'süreli paket (kredi saymaz)'

async function main(): Promise<void> {
  initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID ?? 'studio-yonetim-prod' })
  const db = getFirestore()
  const ctx = {
    studioId: STUDIO,
    actor: { type: 'platform_admin', id: 'migration:tani-esra-tepe' },
    branchIds: ['mutlukent'],
    correlationId: 'tani-esra-tepe',
    source: 'migration',
    role: 'platform_admin',
  } as unknown as TenantContext

  const uyeler = await db.collection(`studios/${STUDIO}/members`).get()
  const bulunan = uyeler.docs.filter((d) => fold(String(d.get('fullName') ?? '')).includes(ARANAN))
  console.log(`━━ ÜYE "${ARANAN}" → ${bulunan.length} eşleşme (${uyeler.size} tarandı)`)
  if (bulunan.length !== 1) {
    const k = uyeler.docs.filter((d) => fold(String(d.get('fullName') ?? '')).includes('esra'))
    console.log(`   "esra" içerenler: ${k.map((d) => `${d.get('fullName')} (${d.id})`).join(' · ') || 'yok'}`)
    process.exit(1)
  }
  const uye = bulunan[0]!
  const memberId = uye.id as MemberId
  console.log(`   ${uye.get('fullName')} · ${memberId}`)

  // ── SATIŞLAR ──
  const satislar = await db.collection(`studios/${STUDIO}/sales`).where('memberId', '==', memberId).get()
  let toplamBorc = 0
  console.log(`\n━━ SATIŞLAR (${satislar.size})`)
  for (const s of satislar.docs) {
    const iptal = s.get('status') === 'cancelled'
    if (!iptal) toplamBorc += Number(s.get('total.amount') ?? 0)
    const lines = (s.get('lines') ?? []) as { description?: string; quantity?: number }[]
    console.log(
      `   ▸ ${s.id}\n` +
      `       ${lines.map((l) => `${l.description} ×${l.quantity}`).join(' | ')}\n` +
      `       toplam ${tl(s.get('total.amount'))} · ödenen ${tl(s.get('paid.amount'))} · ${s.get('status')}` +
      ` · satış ${an(s.get('soldAt'))}` + (iptal ? ` · İPTAL: ${s.get('cancelReason')} (${an(s.get('cancelledAt'))})` : ''),
    )
  }

  // ── ÖDEMELER ──
  const odemeler = await db.collection(`studios/${STUDIO}/payments`).where('memberId', '==', memberId).get()
  let toplamOdenen = 0
  console.log(`\n━━ ÖDEMELER (${odemeler.size})`)
  for (const p of odemeler.docs) {
    const iptal = p.get('voided') === true
    if (!iptal) toplamOdenen += Number(p.get('amount.amount') ?? 0)
    console.log(
      `   ▸ ${p.id} · ${tl(p.get('amount.amount'))} · ${p.get('method')} · tahsis ${tl(p.get('allocated.amount'))}` +
      ` · ${an(p.get('receivedAt'))}` + (iptal ? ` · İPTAL: ${p.get('voidReason')}` : ''),
    )
  }

  // ── TAHSİSLER: hangi para hangi satışa ──
  const tahsisler = await db.collection(`studios/${STUDIO}/allocations`).where('memberId', '==', memberId).get()
  console.log(`\n━━ TAHSİSLER (${tahsisler.size})`)
  if (tahsisler.size === 0) console.log('   (memberId alanı yok olabilir — satış bazlı bakılacak)')
  for (const a of tahsisler.docs) {
    console.log(`   ${a.id} · ödeme ${a.get('paymentId')} → satış ${a.get('saleId')} · ${tl(a.get('amount.amount'))}`)
  }

  // ── PAKETLER ──
  const paketler = await new FirestoreEntitlementRepository(db).listByMember(ctx, memberId)
  console.log(`\n━━ PAKETLER (${paketler.length})`)
  for (const e of paketler) {
    console.log(
      `   ▸ ${e.id}\n` +
      `       ${e.productSnapshot.name} · ${e.status} · kategori=${e.productSnapshot.category}\n` +
      `       ${new Date(e.validFrom as number).toLocaleDateString('tr-TR')} → ${new Date(e.validUntil as number).toLocaleDateString('tr-TR')}\n` +
      `       ${kovalar(e)}\n` +
      `       fiyat ${tl(e.priceAgreed)} · ödenen ${tl(e.paidTotal)}`,
    )
  }

  // ── REZERVASYONLAR: ASIL SORU — hangi paketin üstünde ──
  const rez = await new FirestoreReservationRepository(db).listByMember(ctx, memberId)
  const sayac = new Map<string, { toplam: number; durum: Map<string, number> }>()
  console.log(`\n━━ REZERVASYONLAR (${rez.length})`)
  for (const r of [...rez].sort((a, b) => (a.sessionStartsAt as number) - (b.sessionStartsAt as number))) {
    const k = sayac.get(r.entitlementId as string) ?? { toplam: 0, durum: new Map() }
    k.toplam++
    k.durum.set(r.status, (k.durum.get(r.status) ?? 0) + 1)
    sayac.set(r.entitlementId as string, k)
    console.log(`   ${an(r.sessionStartsAt as number)} · ${r.status.padEnd(14)} · kredi=${r.creditEffect.padEnd(9)} · paket=${r.entitlementId}`)
  }
  console.log(`\n   ── PAKET BAŞINA REZERVASYON ──`)
  for (const [entId, k] of sayac) {
    const p = paketler.find((e) => (e.id as string) === entId)
    console.log(`   ${entId} (${p?.productSnapshot.name ?? 'BİLİNMEYEN'}): ${k.toplam} rezervasyon · ${[...k.durum].map(([d, n]) => `${d}=${n}`).join(' · ')}`)
  }

  // ── PARA ÖZETİ ──
  console.log(`\n━━ PARA`)
  console.log(`   iptal edilmemiş satış toplamı : ${tl(toplamBorc)}`)
  console.log(`   iptal edilmemiş ödeme toplamı : ${tl(toplamOdenen)}`)
  console.log(`   fark (eksi=alacaklı)          : ${tl(toplamOdenen - toplamBorc)}`)
  console.log('\n(salt okunur — hiçbir şey yazılmadı)')
}

main().catch((e) => { console.error(e); process.exit(1) })
