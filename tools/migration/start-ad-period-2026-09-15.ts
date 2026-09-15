import { FirestoreCrmRepository, decideStartAdPeriod, instant, systemClock, type AdPeriod, type TenantContext } from '@studio/core'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

// İLK REKLAM DÖNEMİ: 15 EYLÜL REKLAMI (owner, 2026-09-15).
//
//   pnpm tsx tools/migration/start-ad-period-2026-09-15.ts            (kuru çalışma)
//   pnpm tsx tools/migration/start-ad-period-2026-09-15.ts --apply
//
// Owner: *"şimdi yeni reklam dönemi başladı sıfırlayalım ... 15 eylül reklamından gelenler diye ayraç olsun."*
// Dönemi owner panelden de başlatabilir; bu ilki, özellik yayına girdiği gün owner'ın açıkça istediği
// dönemi açıyor. Domain yolundan geçer (ret kuralları aynı), olay yazar, aday belgelerine dokunmaz.

const STUDIO = 'retro'
const RUN = 'start-ad-period-2026-09-15'
const LABEL = '15 Eylül reklamı'
const STARTED_AT = Date.parse('2026-09-15T00:00:00+03:00')

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply')
  initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID ?? 'studio-yonetim-prod' })
  const db = getFirestore()
  const ctx = {
    studioId: STUDIO,
    actor: { type: 'platform_admin', id: `migration:${RUN}` },
    branchIds: ['mutlukent'],
    role: 'platform_admin',
  } as unknown as TenantContext
  const repo = new FirestoreCrmRepository(db)
  const current = await repo.getCurrentAdPeriod(ctx)
  console.log(apply ? '── UYGULANIYOR ──' : '── KURU ÇALIŞMA ──')
  console.log('şu anki dönem:', current ? `${current.label} (${new Date(current.startedAt).toISOString()})` : 'yok')

  const now = systemClock.now()
  const period: AdPeriod = {
    id: 'adp_2026_09_15',
    studioId: STUDIO as AdPeriod['studioId'],
    label: LABEL,
    startedAt: instant(STARTED_AT),
    createdAt: now,
    createdBy: ctx.actor,
  }
  const decided = decideStartAdPeriod(
    { studioId: ctx.studioId, actor: ctx.actor, now, correlationId: RUN as never, source: 'migration' },
    period,
    current,
  )
  if (!decided.ok) return console.log('REDDEDİLDİ:', decided.error.code)
  const since = await repo.listLeadsSince(ctx, STARTED_AT)
  console.log(`bu dönemin adayı: ${since.length} · başlangıç ${new Date(STARTED_AT).toISOString()}`)
  if (!apply) return console.log('kuru çalışma — yazılmadı')
  await repo.saveAdPeriod(ctx, decided.value.next, decided.value.events)
  console.log('dönem açıldı:', LABEL)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
