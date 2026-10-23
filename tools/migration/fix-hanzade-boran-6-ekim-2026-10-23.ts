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

// HANZADE BORAN — 6 EKİM 20:00 REFORMER'A EKLE, 1 KREDİ DÜŞSÜN (owner, 2026-10-23)
//
//   pnpm tsx tools/migration/fix-hanzade-boran-6-ekim-2026-10-23.ts            # kuru çalışma
//   pnpm tsx tools/migration/fix-hanzade-boran-6-ekim-2026-10-23.ts --apply    # yaz
//
// Masanın "Sonradan üye ekle" düğmesiyle aynı use-case (`bookPastAttended`, 30 gün penceresi içinde): rezervasyon +
// katıldı tek işlemde, Reformer 8 Ders paketinden (06.10 → 05.11) bir hak tüketilir.
//
// Seans DOLU çıktı: 2 rezervasyon + 6 misafire AYRILAN yer = 8/8 (`class_full`, hiçbir şey yazılmadı). Owner: *"kapasiteyi
// 9 yap"* — 6 misafir de geldi, Hanzade 9. kişi. Önce `changeCapacity` 8 → 9 (sebepli), sonra ekleme.

const STUDIO = 'retro'
const BRANCH = 'mutlukent'
const RUN = 'fix-hanzade-boran-6-ekim-2026-10-23'
const APPLY = process.argv.includes('--apply')
const VAKA = {
  memberId: 'mem_01M493NJ4P2N16KJA1PFW1KMBV' as MemberId,
  sessionId: 'cls_01M3PXSN3CF34CEC9J8N3M3F7D' as ClassSessionId,
  entitlementId: 'ent_01M496N3R6CHR1NMMGBZW1B75D' as EntitlementId,
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
  console.log(`━━ ${member.fullName} · 06.10.2026 20:00 Reformer · ${APPLY ? 'UYGULANIYOR' : 'KURU ÇALIŞMA'}`)
  console.log(`   paket: ${ent.productSnapshot.name} · kullanılabilir ${available(ent.credits)}${zaten ? ` · ZATEN SEANSTA (${zaten.status})` : ''}`)
  const seans = await sched.getSession(ctx, VAKA.sessionId)
  if (!seans) return dur('seans yok.')
  console.log(`   seans kapasitesi ${seans.capacity}${seans.capacity < 9 ? ' → 9' : ''}`)
  if (!APPLY || zaten) { if (!APPLY) console.log('   --apply ile çalıştır.'); return }

  if (seans.capacity < 9) {
    const c = await changeCapacity({ repo: sched, clock: systemClock, studioConfig: DEFAULT_STUDIO_CONFIG, hours }, ctx, {
      sessionId: VAKA.sessionId,
      capacity: 9,
      reason: '6 Ekim 20:00 Reformer: 6 misafir yerinin hepsi kullanıldı, Hanzade Boran 9. kişi olarak derse girdi (owner, 2026-10-23).',
    })
    if (!c.ok) return dur(`kapasite: ${JSON.stringify(c.error)}`)
    console.log('   ✓ kapasite 9')
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
