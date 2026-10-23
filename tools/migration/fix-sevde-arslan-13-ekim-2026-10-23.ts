import {
  available,
  bookPastAttended,
  changeCapacity,
  DEFAULT_STUDIO_CONFIG,
  FirestoreSchedulingRepository,
  FirestoreEntitlementRepository,
  FirestoreMemberRepository,
  FirestoreReservationRepository,
  FirestoreStudioHours,
  instant,
  systemClock,
  toMemberSnapshot,
  type ClassSessionId,
  type EntitlementId,
  type MemberId,
  type TenantContext,
} from '@studio/core'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

// SEVDE ARSLAN — 13 EKİM 19:00 REFORMER'A EKLE, DOLUYSA KAPASİTE ARTSIN, 1 KREDİ DÜŞSÜN (owner, 2026-10-23)
//
//   pnpm tsx tools/migration/fix-sevde-arslan-13-ekim-2026-10-23.ts            # kuru çalışma
//   pnpm tsx tools/migration/fix-sevde-arslan-13-ekim-2026-10-23.ts --apply    # yaz
//
// Masanın "Sonradan üye ekle" düğmesiyle aynı use-case (`bookPastAttended`, 30 gün penceresi içinde): rezervasyon +
// katıldı tek işlemde, Reformer 8 Ders paketinden (13.10 → 12.11) bir hak tüketilir.
//
// Seans zaten 9 kişilikti (Burçin için 13.10'da 8 → 9) ve DOLU: 8 rezervasyon + 1 misafir yeri. Owner: *"kapasiteyi 10 yap"* —
// misafir de geldi, Sevde 10. kişi. Önce `changeCapacity` 9 → 10 (sebepli), sonra ekleme.

const STUDIO = 'retro'
const BRANCH = 'mutlukent'
const RUN = 'fix-sevde-arslan-13-ekim-2026-10-23'
const APPLY = process.argv.includes('--apply')
const VAKA = {
  memberId: 'mem_01M4V3A7W8V9NY2V81R0E5ENKA' as MemberId,
  sessionId: 'cls_01M3PXSMYZCTZA9JDYHK0BTHDR' as ClassSessionId,
  entitlementId: 'ent_01M4V3HSV7K944RQ3QN74KK1Z7' as EntitlementId,
} as const

async function main(): Promise<void> {
  initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID ?? 'studio-yonetim-prod' })
  const db = getFirestore()
  const ctx = {
    studioId: STUDIO,
    actor: { type: 'platform_admin', id: `migration:${RUN}` },
    branchIds: [BRANCH],
    correlationId: RUN,
    source: 'migration',
    role: 'platform_admin',
  } as unknown as TenantContext
  const members = new FirestoreMemberRepository(db)
  const ents = new FirestoreEntitlementRepository(db)
  const repo = new FirestoreReservationRepository(db)
  const sched = new FirestoreSchedulingRepository(db)
  const hours = new FirestoreStudioHours(db)
  const dur = (m: string): never => { console.error(`DUR: ${m}`); process.exit(1) }

  const [member, ent, mevcut] = await Promise.all([
    members.findById(ctx, VAKA.memberId),
    ents.getEntitlement(ctx, VAKA.entitlementId),
    repo.listBySession(ctx, VAKA.sessionId),
  ])
  if (!member || !ent || ent.memberId !== VAKA.memberId || !ent.credits) return dur('üye/paket tanıdaki gibi değil.')
  const zaten = mevcut.find((r) => r.memberId === VAKA.memberId && r.status !== 'cancelled' && r.status !== 'late_cancelled')
  console.log(`━━ ${member.fullName} · 13.10.2026 19:00 Reformer · ${APPLY ? 'UYGULANIYOR' : 'KURU ÇALIŞMA'}`)
  console.log(`   paket: ${ent.productSnapshot.name} · kullanılabilir ${available(ent.credits)}${zaten ? ` · ZATEN SEANSTA (${zaten.status})` : ''}`)
  const seans = await sched.getSession(ctx, VAKA.sessionId)
  if (!seans) return dur('seans yok.')
  console.log(`   seans kapasitesi ${seans.capacity}${seans.capacity < 10 ? ' → 10' : ''}`)
  if (!APPLY || zaten) { if (!APPLY) console.log('   --apply ile çalıştır.'); return }

  if (seans.capacity < 10) {
    const c = await changeCapacity({ repo: sched, clock: systemClock, studioConfig: DEFAULT_STUDIO_CONFIG, hours }, ctx, {
      sessionId: VAKA.sessionId,
      capacity: 10,
      reason: '13 Ekim 19:00 Reformer: 9 kişilik seans doluydu (8 üye + 1 misafir), Sevde Arslan 10. kişi olarak derse girdi (owner, 2026-10-23).',
    })
    if (!c.ok) return dur(`kapasite: ${JSON.stringify(c.error)}`)
    console.log('   ✓ kapasite 10')
  }

  const r = await bookPastAttended(
    { repo, clock: systemClock, hours, policy: { getMemberOverride: async () => member.restriction ?? null } },
    ctx,
    {
      sessionId: VAKA.sessionId,
      entitlementId: VAKA.entitlementId,
      memberId: VAKA.memberId,
      memberSnapshot: toMemberSnapshot(member),
      earliest: instant(Date.now() - 30 * 86_400_000),
    },
  )
  if (!r.ok) return dur(JSON.stringify(r.error))
  const sonra = await ents.getEntitlement(ctx, VAKA.entitlementId)
  console.log(`✅ eklendi, katıldı · kalan hak ${sonra?.credits ? available(sonra.credits) : '?'}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
