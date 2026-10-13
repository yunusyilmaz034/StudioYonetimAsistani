import { amendEntitlement, FirestoreEntitlementRepository, instant, systemClock, type EntitlementId, type MemberId, type TenantContext } from '@studio/core'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

// GAMZE PİLATİN KOZLUK — FITNESS 3 AYLIK: bitiş 06.10 → 27.10 (owner, 2026-10-13)
//
//   pnpm tsx tools/migration/fix-gamze-pilatin-uzatma-2026-10-13.ts            # kuru çalışma
//   pnpm tsx tools/migration/fix-gamze-pilatin-uzatma-2026-10-13.ts --apply    # yaz
//
// Owner: *"gamze pilatin pasif paketi var, 06.10'da bitmiş, onu 27.10'a kadar uzatır mısın."*
//
// Tanı (`tani-gamze-pilatin-2026-10-13.ts`): tek paketi var — Fitness 3 Aylık, süreli (kredisiz, sınırsız
// giriş), 08.07 → 06.10, 6 Ekim 03:00 taramasında süresi dolmuş. Açık rezervasyonu yok.
//
// Tek işlem, masanın "Düzenle"siyle aynı use-case: `amendEntitlement` — bitiş geleceğe taşınınca
// süreli paket canlanır (`entitlement.amended` + `entitlement.reactivated`). Para ve başlangıç değişmez.

const STUDIO = 'retro'
const RUN = 'fix-gamze-pilatin-uzatma-2026-10-13'
const APPLY = process.argv.includes('--apply')
const VAKA = {
  memberId: 'mem_01KXN390RVBX8V0YF0116QN5JN' as MemberId,
  entitlementId: 'ent_01KYTE4Y8E7PX7KS9VWEYZ5XF6' as EntitlementId,
  eskiBitis: '2026-10-06',
  yeniBitis: '2026-10-27',
} as const
const REASON = 'Fitness 3 Aylık paketin bitişi 06.10.2026 → 27.10.2026 uzatıldı (owner talimatı, 2026-10-13).'

const dayMs = (iso: string): number => Date.parse(`${iso}T00:00:00+03:00`)
const gun = (ms: number): string => new Date(ms).toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul' })

async function main(): Promise<void> {
  initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID ?? 'studio-yonetim-prod' })
  const ctx = { studioId: STUDIO, actor: { type: 'platform_admin', id: `migration:${RUN}` }, branchIds: ['mutlukent'], correlationId: RUN, source: 'migration', role: 'platform_admin' } as unknown as TenantContext
  const repo = new FirestoreEntitlementRepository(getFirestore())
  const ent = await repo.getEntitlement(ctx, VAKA.entitlementId)

  const dur = (m: string): never => { console.error(`DUR: ${m}`); process.exit(1) }
  if (!ent) return dur('paket yok.')
  if (ent.memberId !== VAKA.memberId) dur('paket bu üyeye ait değil.')
  console.log(`━━ ${ent.productSnapshot.name} · ${ent.status} · ${gun(ent.validFrom as number)} → ${gun(ent.validUntil as number)}`)
  if (ent.status === 'active' && (ent.validUntil as number) === dayMs(VAKA.yeniBitis)) { console.log('DUR: zaten uzatılmış.'); return }
  if (ent.credits) dur('kredili paket — bu betik süreli paket için.')
  if (ent.status !== 'expired') dur(`beklenmeyen durum: ${ent.status}`)
  if ((ent.validUntil as number) !== dayMs(VAKA.eskiBitis)) dur('bitiş tanıdakinden farklı — arada biri dokunmuş.')

  console.log(`   HEDEF: bitiş ${gun(dayMs(VAKA.yeniBitis))} · aktif\n   sebep: ${REASON}`)
  if (!APPLY) { console.log('\n── KURU ÇALIŞMA ── --apply ile çalıştır.'); return }

  const r = await amendEntitlement({ repo, clock: systemClock }, ctx, { entitlementId: ent.id, patch: { validUntil: instant(dayMs(VAKA.yeniBitis)) }, reason: REASON })
  if (!r.ok) dur(`BAŞARISIZ: ${JSON.stringify(r.error)}`)
  const son = (await repo.getEntitlement(ctx, VAKA.entitlementId))!
  console.log(`\n✅ UYGULANDI · ${son.status} · ${gun(son.validFrom as number)} → ${gun(son.validUntil as number)}`)
}
main().catch((e) => { console.error(e); process.exit(1) })
