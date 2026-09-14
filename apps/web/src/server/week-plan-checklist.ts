import {
  DEFAULT_STUDIO_CONFIG,
  FirestoreStaffWeekPlanRepository,
  addLocalDays,
  daysBetween,
  instant,
  loadWeekPlans,
  localDateAt,
  mondayOf,
  systemClock,
  type StaffWeekPlan,
  type TenantContext,
} from '@studio/core'

import { adminDb } from './firebase-admin'
import type { AdvisorItem } from './advisor-query'

// ── VARDİYA PLANI, PANODA (owner, 2026-09-14 · OR-77) ──────────────────────────────────────
//
// *"cuma bu planlama yapılsın cumartesi onaylansın ve hafta hazır olsun."* Sistem cumayı ve cumartesiyi
// KİLİTLEMİYOR — hatırlatıyor. Panoya düşen şey planın kendisi değil, onun EKSİĞİ:
//
//   · Bu haftanın hiç onaylanmış planı yok → acil (hafta başlamış, personel ne zaman geleceğini bilmiyor).
//   · Cumadan itibaren önümüzdeki hafta onaya gönderilmemiş → dikkat; pazar acil.
//   · Onay bekleyen plan (önümüzdeki hafta cumartesiden itibaren, ya da hafta içi değişiklik) → owner'ın işi.
//
// PLANI HİÇ KULLANMAYAN STÜDYOYA HİÇBİR ŞEY DÜŞMEZ. Tek bir plan belgesi yoksa bu özellik henüz
// açılmamıştır; her gün "plan yok" demek, panoyu okunmaz yapan gürültünün ta kendisi olurdu.

const OFF = DEFAULT_STUDIO_CONFIG.utcOffsetMinutes
const CUMA = 4
const CUMARTESI = 5
const PAZAR = 6

export async function weekPlanAdvisorItems(ctx: TenantContext): Promise<readonly AdvisorItem[]> {
  const db = adminDb()
  const hic = await db.collection('studios').doc(ctx.studioId).collection('staffWeekPlans').limit(1).get()
  if (hic.empty) return []

  const bugun = localDateAt(instant(Date.now()), OFF)
  const buHafta = mondayOf(bugun)
  const gelecek = addLocalDays(buHafta, 7)
  const gun = daysBetween(buHafta, bugun) // 0 = pazartesi … 6 = pazar
  const deps = { repo: new FirestoreStaffWeekPlanRepository(db), clock: systemClock, utcOffsetMinutes: OFF }
  const planlar = await loadWeekPlans(deps, ctx, [buHafta, gelecek])
  const bul = (w: string): StaffWeekPlan | null => planlar.find((p) => p.weekStart === w) ?? null
  const bu = bul(buHafta)
  const sonraki = bul(gelecek)

  const items: AdvisorItem[] = []
  const satir = (id: string, severity: AdvisorItem['severity'], title: string, detail: string): AdvisorItem => ({
    id,
    kind: 'staff_plan',
    severity,
    subject: null,
    title,
    detail,
    href: '/mesai',
    actionLabel: 'Planı aç',
  })

  // Bu hafta
  if (!bu?.published) {
    items.push(
      satir(
        `week_plan_unpublished__${buHafta}`,
        'urgent',
        'Bu haftanın vardiya planı onaylanmadı',
        bu?.status === 'submitted' ? 'Plan onay bekliyor. Personel ne zaman geleceğini henüz göremiyor.' : 'Hafta başladı ama personel planı göremiyor. Hazırlayıp onaylayın.',
      ),
    )
  } else if (bu.status === 'submitted') {
    items.push(satir(`week_plan_change__${buHafta}_${bu.version}`, 'attention', 'Bu haftanın plan değişikliği onay bekliyor', 'Onaylanana kadar personel eski saatini görüyor.'))
  }

  // Önümüzdeki hafta — cumadan itibaren
  if (gun >= CUMA) {
    if (!sonraki || (sonraki.published === null && sonraki.status === 'draft')) {
      items.push(
        satir(
          `week_plan_not_submitted__${gelecek}`,
          gun === PAZAR ? 'urgent' : 'attention',
          'Önümüzdeki haftanın vardiya planı onaya gönderilmedi',
          sonraki?.returnReason ? `Owner geri göndermişti: ${sonraki.returnReason}` : 'Cuma hazırlanıp cumartesi onaylanması gerekiyordu.',
        ),
      )
    } else if (sonraki.status === 'submitted' && gun >= CUMARTESI) {
      items.push(satir(`week_plan_awaiting__${gelecek}_${sonraki.version}`, gun === PAZAR ? 'urgent' : 'attention', 'Önümüzdeki haftanın vardiya planı onay bekliyor', 'Onaylayınca personel kendi ekranında görecek.'))
    }
  }
  return items
}
