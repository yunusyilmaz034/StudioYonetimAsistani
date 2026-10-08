import {
  FirestoreEntitlementRepository,
  FirestoreReservationRepository,
  type MemberId,
  type TenantContext,
} from '@studio/core'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

// BURÇİN GÖKNİL KAYA — PAKET TARİHİ: TANI (owner, 2026-10-08)
//
//   pnpm tsx tools/migration/tani-burcin-goknil-kaya-2026-10-08.ts
//
// SALT OKUNUR. Hiçbir şey yazmaz, `--apply` yoktur.
//
// Owner: *"paketi 8'de başlamış ama paket tarihini 15'ten başlat, bitişi de diğer ayın 15'i olarak
// düzelt."*
//
// Ölçülecek: hangi paket 8'inde başlıyor, demet mi (iki satır), ve 8–15 arasına düşen bir
// rezervasyon/giriş o pakete bağlı mı — başlangıç ileri alınınca pencerenin dışında kalır.

const STUDIO = 'retro'
const ARANAN = 'burcin goknil kaya'

const fold = (s: string): string =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ı/g, 'i').replace(/İ/g, 'i').toLowerCase().trim()
const an = (v: unknown): string =>
  typeof v === 'number' ? new Date(v).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' }) : '—'

async function main(): Promise<void> {
  initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID ?? 'studio-yonetim-prod' })
  const db = getFirestore()
  const ctx = {
    studioId: STUDIO,
    actor: { type: 'platform_admin', id: 'migration:tani-burcin-goknil-kaya' },
    branchIds: ['mutlukent'],
    correlationId: 'tani-burcin-goknil-kaya',
    source: 'migration',
    role: 'platform_admin',
  } as unknown as TenantContext

  const uyeler = await db.collection(`studios/${STUDIO}/members`).get()
  const bulunan = uyeler.docs.filter((d) => fold(String(d.get('fullName') ?? '')).includes(ARANAN))
  console.log(`━━ ÜYE "${ARANAN}" → ${bulunan.length} eşleşme (${uyeler.size} tarandı)`)
  if (bulunan.length !== 1) {
    const k = uyeler.docs.filter((d) => {
      const ad = fold(String(d.get('fullName') ?? ''))
      return ad.includes('burcin') || ad.includes('goknil')
    })
    console.log(`   "burcin"/"goknil" içerenler: ${k.map((d) => `${d.get('fullName')} (${d.id})`).join(' · ') || 'yok'}`)
    process.exit(1)
  }
  const uye = bulunan[0]!
  const memberId = uye.id as MemberId
  console.log(`   ${uye.get('fullName')} · ${memberId}`)

  const paketler = await new FirestoreEntitlementRepository(db).listByMember(ctx, memberId)
  console.log(`\n━━ PAKETLER (${paketler.length})`)
  for (const e of paketler) {
    const ham = (await db.doc(`studios/${STUDIO}/entitlements/${e.id}`).get()).data() ?? {}
    console.log(
      `   ▸ ${e.id}\n` +
      `       ${e.productSnapshot.name} · ${e.status} · kategori=${e.productSnapshot.category} · grant=${JSON.stringify(e.productSnapshot.grant)}\n` +
      `       ${an(e.validFrom as number)} → ${an(e.validUntil as number)}\n` +
      `       krediler=${JSON.stringify(e.credits ?? null)} · demet=${JSON.stringify(ham.bundleId ?? ham.bundle ?? null)} · satış=${ham.saleId ?? '—'}\n` +
      `       dondurma=${JSON.stringify(ham.freeze ?? ham.freezes ?? null)}`,
    )
  }

  const rez = await new FirestoreReservationRepository(db).listByMember(ctx, memberId)
  console.log(`\n━━ REZERVASYONLAR (${rez.length})`)
  for (const r of [...rez].sort((a, b) => (a.sessionStartsAt as number) - (b.sessionStartsAt as number))) {
    console.log(`   ${an(r.sessionStartsAt as number)} · ${r.status.padEnd(14)} · kredi=${r.creditEffect.padEnd(9)} · paket=${r.entitlementId}`)
  }

  const girisler = await db.collection(`studios/${STUDIO}/checkIns`).where('memberId', '==', memberId).get()
  console.log(`\n━━ GİRİŞLER (${girisler.size})`)
  for (const g of girisler.docs) {
    const t = g.get('occurredAt') ?? g.get('checkedInAt')
    console.log(`   ${an(t?.toMillis?.() ?? t)} · paket=${g.get('entitlementId') ?? '—'} · ${g.id}`)
  }

  const olaylar = await db.collection(`studios/${STUDIO}/events`).where('related.memberId', '==', memberId).get()
  const sirali = [...olaylar.docs].sort((a, b) => a.id.localeCompare(b.id))
  console.log(`\n━━ OLAYLAR (${sirali.length})`)
  for (const o of sirali) {
    const t = o.get('occurredAt')
    console.log(
      `   ${an(t?.toMillis?.() ?? t)} · ${String(o.get('type')).padEnd(34)} · ${o.get('actor.type')}` +
      ` · paket=${o.get('related.entitlementId') ?? '—'}\n       ${JSON.stringify(o.get('payload') ?? {})}`,
    )
  }
  console.log('\n(salt okunur — hiçbir şey yazılmadı)')
}

main().catch((e) => { console.error(e); process.exit(1) })
