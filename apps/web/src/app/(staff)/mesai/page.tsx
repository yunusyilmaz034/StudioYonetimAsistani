import { addLocalDays, daysBetween, mondayOf } from '@studio/core'

import { requirePageAccess } from '@/server/auth'
import { studioToday } from '@/server/reservations-query'
import { loadShiftView } from '@/server/shift-query'

import { MesaiScreen } from './mesai-screen'
import { WeekPlanPanel } from './week-plan-panel'

// MESAİ (owner, 2026-09-01).
//
// Owner: *"personel de giriş çıkış yapabilsin pdks gibi değil de en azından saat kaçta girdi çıktı
// görsek yeterli."*
//
// Turnikeden ayrı, bilerek: personel gün içinde defalarca geçiyor (kargo, öğle, komşu dükkân) ve
// her geçişi mesai saymak "saat kaçta geldi" sorusunu otuz satıra çevirir. Geçiş sürtünmesiz kalır,
// vardiya günde iki kez bilinçli olarak yazılır.
//
// `?gun=YYYY-MM-DD` (owner, 2026-09-14 · OR-77): geçmiş bir günün giriş-çıkışları. GELECEK GÜN YOK —
// hiç geçiş olmamış bir günü açmak boş bir liste gösterir ve "kimse gelmedi" diye okunur.
//
// HAFTALIK VARDİYA PLANI (OR-77) owner ve resepsiyona, sayfanın altında ve daha geniş: yedi günlük
// tablo dar sütuna sığmaz. CUMADAN İTİBAREN önümüzdeki hafta açılır — cuma, planın hazırlandığı gün.
export default async function MesaiPage({ searchParams }: { searchParams: Promise<{ gun?: string }> }) {
  const ctx = await requirePageAccess('/mesai')
  const bugun = studioToday()
  const { gun } = await searchParams
  const tarih = gun && /^\d{4}-\d{2}-\d{2}$/.test(gun) && gun <= bugun ? gun : bugun
  const view = await loadShiftView(ctx, tarih)

  const planlayan = ctx.actor.type === 'owner' || ctx.actor.type === 'receptionist' || ctx.actor.type === 'platform_admin'
  const pazartesi = mondayOf(bugun)
  const planHaftasi = daysBetween(pazartesi, bugun) >= 4 ? addLocalDays(pazartesi, 7) : pazartesi

  return (
    <>
      <MesaiScreen
        view={view}
        bugun={bugun}
        ownerMu={ctx.actor.type === 'owner' || ctx.actor.type === 'platform_admin'}
      />
      {planlayan ? (
        <section className="mx-auto max-w-6xl px-4 pb-8 sm:px-6">
          <WeekPlanPanel initialWeek={planHaftasi} />
        </section>
      ) : null}
    </>
  )
}
