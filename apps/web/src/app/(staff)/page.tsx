import type { PrincipalRole } from '@studio/core'

import type { AdvisorItem } from '@/server/advisor-query'

import { requirePageAccess } from '@/server/auth'
import { deriveAdvisorItems } from '@/server/advisor-query'
import { doorRefusalAdvisorItems } from '@/server/door-refusal-checklist'
import { hotLeadAdvisorItems } from '@/server/lead-checklist'
import { leaveAdvisorItems } from '@/server/leave-checklist'
import { loadOwnerDashboard } from '@/server/owner-dashboard'
import { onlinePaymentAdvisorItems } from '@/server/online-payment-checklist'
import { loadSnoozedItemIds } from '@/server/checklist-snooze'
import { loadTodayOps } from '@/server/today-ops'

import { DashboardScreen } from './dashboard-screen'

// The owner dashboard IS the staff home (UX-8): the owner opens the product and immediately knows
// what needs attention today. v1.23 rebuilt it on the WIDGET contract over the daily read model —
// a fixed number of reads (1 projection + 5 bounded state queries, in parallel), whatever the size
// of the studio. It writes nothing and decides nothing.
// A TRAINER never reaches this page: `requirePageAccess` sends her to `/my-classes`, which is the
// only screen she has. She is staff, and she is also the person least entitled to the studio's
// data — so her home is not this one minus a few widgets; it is a different screen entirely.
// ── EK LİSTELER PANOYU DÜŞÜREMEZ (2026-09-11, canlıda öğrenildi) ────────────────────────────
//
// İzin listesi eksik bir Firestore index'i yüzünden fırlattı ve `Promise.all` bütün sayfayı
// çökertti: owner'ın ana ekranı "Application error" oldu. Panonun ÇEKİRDEĞİ (gün özeti, bugünün
// işleri) düşerse sayfa gerçekten düşmeli — o veriler olmadan sayfanın anlamı yok. Ama EK listeler
// birer katkıdır: biri gelmezse pano yine işe yarar.
//
// HATA YUTULMUYOR. Konsola yazılıyor ve ekranda hangi bölümün gelmediği söyleniyor — sessizce boş
// dönen bir liste, "bugün iş yok" ile "liste gelmedi"yi aynı gösterir, ve ikisi aynı şey değildir.
async function ekListe(
  ad: string,
  f: () => Promise<readonly AdvisorItem[]>,
): Promise<{ items: readonly AdvisorItem[]; hata: string | null }> {
  try {
    return { items: await f(), hata: null }
  } catch (e) {
    console.error(`[dashboard] ${ad} listesi alınamadı`, e)
    return { items: [], hata: ad }
  }
}

export default async function HomePage() {
  const ctx = await requirePageAccess('/')
  const now = Date.now()
  const [data, todayOps, hotLeads, doorRefusals, leaves, onlinePayments, snoozed] = await Promise.all([
    loadOwnerDashboard(ctx, now),
    loadTodayOps(ctx, now),
    ekListe('WhatsApp lead’leri', () => hotLeadAdvisorItems(ctx)),
    ekListe('Kapıda kalanlar', () => doorRefusalAdvisorItems(ctx)),
    ekListe('İzinler', () => leaveAdvisorItems(ctx)),
    ekListe('Online ödemeler', () => onlinePaymentAdvisorItems(ctx)),
    loadSnoozedItemIds(ctx.studioId as string, now),
  ])
  const eksik = [hotLeads, doorRefusals, leaves, onlinePayments].map((x) => x.hata).filter((x): x is string => x !== null)
  // Card money FIRST — it is the one thing on this list that has already happened, and until it is
  // somewhere he looks, "did that payment arrive?" is a question only the provider's panel answers.
  // Then hot WhatsApp leads (act now), then the dashboard-derived advisor items.
  // Kapıda kalan üye lead'in de ÖNÜNDE: yola çıkmış, gelmiş ve geri dönmüş biri, fiyat sormuş
  // birinden daha ileridedir — ve o gün aranmazsa gitmiş sayılır.
    // Eğitmensiz kalan ders, kapıda kalan üyeden SONRA ama lead'lerden önce: biri bugünün işi, öbürü
  // bu haftanın — ama ikisi de kaçırılırsa telefonla öğrenilir.
  const allItems = [...doorRefusals.items, ...leaves.items, ...onlinePayments.items, ...hotLeads.items, ...deriveAdvisorItems(data)]
  // A line already ticked off stays off for its cooldown — reception called that member, and a call is
  // not work again tomorrow (owner, 2026-09-03). Filtered HERE, before the AI narrator sees the list,
  // so the briefing at the top counts the same work the rows below show.
  const advisorItems = allItems.filter((it) => !snoozed.has(it.id))
  const snoozedCount = allItems.length - advisorItems.length
  return (
    <DashboardScreen
      data={data}
      todayOps={todayOps}
      advisorItems={advisorItems}
      snoozedCount={snoozedCount}
      eksikListeler={eksik}
      role={ctx.role}
      roleLabel={roleLabel(ctx.role)}
    />
  )
}

function roleLabel(role: PrincipalRole): string {
  switch (role) {
    case 'owner':
      return 'Sahip'
    case 'receptionist':
      return 'Resepsiyon'
    case 'trainer':
      return 'Eğitmen'
    default:
      return ''
  }
}
