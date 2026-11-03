import {
  amendEntitlement,
  available,
  FirestoreEntitlementRepository,
  instant,
  systemClock,
  type EntitlementId,
  type TenantContext,
} from '@studio/core'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

// ESRA TEPE — 8 DERS PAKETİ 30 GÜNE ÇEKİLİYOR (owner, 2026-11-03)
//
//   pnpm tsx tools/migration/fix-esra-tepe-sure-30-gun-2026-11-03.ts            # kuru çalışma
//   pnpm tsx tools/migration/fix-esra-tepe-sure-30-gun-2026-11-03.ts --apply    # yaz
//
// 6 Ekim'de paket 24 Ders'ten 8 Ders'e çekilirken süre BİLEREK 90 günde (→ 29.11) bırakılmıştı, kalan 5 ders
// yanmasın diye (`fix-esra-tepe-paket-etiketi-2026-10-06.ts`). Owner bugün tersine karar verdi: *"bitti paketi
// onun, aynen 1 aylık kullanım süresi ile sınırla; ne kadar kredisi kaldıysa ona göre kalsın."*
//
// Yalnız `validUntil` değişir: 29.11 → 30.09.2026 (satıştaki 8 Ders'in kendi bitişi, `entitlement.purchased`
// olayındaki `validUntil`). Kredilere dokunulmaz — 5 kullanılmamış hak gece süpürmesinde (`system`) `expired` olur,
// tıpkı süresi dolan her paket gibi. Bu betik paketi kendisi BİTİRMEZ: bitirmek süpürmenin işi (I-19).

const STUDIO = 'retro'
const RUN = 'fix-esra-tepe-sure-30-gun-2026-11-03'
const APPLY = process.argv.includes('--apply')
const ENT = 'ent_01M1CA6JH244MSJ4R9Y1MM2H2J' as EntitlementId
const ESKI_BITIS = 1_795_899_600_000 // 29.11.2026 00:00 +03
const YENI_BITIS = 1_790_715_600_000 // 30.09.2026 00:00 +03 — satıştaki 30 günlük bitiş
const REASON =
  'Esra Tepe 8 Ders paketi: süre 24 Ders düzeltmesinden 90 gün kalmıştı; 8 Ders\'in 30 günlük süresine çekildi ' +
  '(31.08 → 30.09.2026). Kalan haklar süresi dolan paket gibi işlenir (owner, 2026-11-03).'

async function main(): Promise<void> {
  initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID ?? 'studio-yonetim-prod' })
  const db = getFirestore()
  const ctx = {
    studioId: STUDIO,
    actor: { type: 'platform_admin', id: `migration:${RUN}` },
    branchIds: ['mutlukent'],
    correlationId: RUN,
    source: 'migration',
    role: 'platform_admin',
  } as unknown as TenantContext
  const deps = { repo: new FirestoreEntitlementRepository(db), clock: systemClock }
  const ent = await deps.repo.getEntitlement(ctx, ENT)
  if (!ent || ent.productSnapshot.name !== 'Reformer Pilates - 8 Ders' || !ent.credits) {
    console.error('DUR: paket tanıdaki gibi değil.')
    process.exit(1)
  }
  const gun = (t: number) => new Date(t).toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul' })
  console.log(`━━ ESRA TEPE · ${APPLY ? 'UYGULANIYOR' : 'KURU ÇALIŞMA'}`)
  console.log(`   bitiş : ${gun(ent.validUntil as number)} → ${gun(YENI_BITIS)} · kalan hak ${available(ent.credits)} · tutulan ${ent.credits.held}`)
  if (ent.validUntil === YENI_BITIS) return console.log('   zaten 30.09 — yapılacak bir şey yok.')
  if (ent.validUntil !== ESKI_BITIS) {
    console.error('DUR: bitiş 29.11 değil, biri değiştirmiş.')
    process.exit(1)
  }
  if (ent.credits.held > 0) {
    console.error('DUR: rezervasyonda tutulan hak var; önce o çözülmeli.')
    process.exit(1)
  }
  if (!APPLY) return console.log('   --apply ile çalıştır.')
  const r = await amendEntitlement(deps, ctx, { entitlementId: ENT, patch: { validUntil: instant(YENI_BITIS) }, reason: REASON })
  if (!r.ok) {
    console.error(`DUR: ${JSON.stringify(r.error)}`)
    process.exit(1)
  }
  const sonra = await deps.repo.getEntitlement(ctx, ENT)
  console.log(`✅ bitiş ${gun(sonra!.validUntil as number)} · durum ${sonra!.status} · gece süpürmesi paketi bitirecek`)
}

main().catch((e) => { console.error(e); process.exit(1) })
