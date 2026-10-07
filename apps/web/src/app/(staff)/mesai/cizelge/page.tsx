import { redirect } from 'next/navigation'

import { addLocalDays, mondayOf } from '@studio/core'

import { requirePageAccess } from '@/server/auth'
import { studioToday } from '@/server/reservations-query'
import { loadTimesheetWeek } from '@/server/timesheet-query'

import { CizelgeScreen } from './cizelge-screen'

// HAFTALIK RAPOR VE ÇİZELGE (owner, 2026-10-07 · OR-119 · Faz 6).
//
// Owner: *"Tam zamanlı eğitmenlerin çalışma ve ara dinlenme sürelerini doğru ve denetlenebilir
// şekilde takip etmek istiyoruz… Bu özellik bir bordro veya otomatik ücret kesme sistemi değildir."*
//
// Masanın ekranı: patron ve resepsiyon. Eğitmen `/mesai`yi görür ama buraya giremez — bir hocanın bir
// başkasının haftasını görmesi için bir sebep yok (aynı kural `/mesai`daki gün listesinde de duruyor).
//
// GELECEK HAFTA YOK: yaşanmamış bir haftanın çizelgesi yedi boş satırdır ve "kimse çalışmadı" diye
// okunur.
export default async function CizelgePage({ searchParams }: { searchParams: Promise<{ hafta?: string }> }) {
  const ctx = await requirePageAccess('/mesai')
  if (ctx.actor.type === 'trainer') redirect('/mesai')

  const buHafta = mondayOf(studioToday())
  const { hafta } = await searchParams
  const istenen = hafta && /^\d{4}-\d{2}-\d{2}$/.test(hafta) ? mondayOf(hafta) : buHafta
  const weekStart = istenen <= buHafta ? istenen : buHafta
  const view = await loadTimesheetWeek(ctx, weekStart)

  return (
    <CizelgeScreen
      view={view}
      oncekiHafta={addLocalDays(weekStart, -7)}
      sonrakiHafta={weekStart < buHafta ? addLocalDays(weekStart, 7) : null}
      buHafta={buHafta}
    />
  )
}
