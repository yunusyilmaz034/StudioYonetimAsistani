import { requirePageAccess } from '@/server/auth'
import { studioToday } from '@/server/reservations-query'
import { loadShiftView } from '@/server/shift-query'

import { MesaiScreen } from './mesai-screen'

// MESAİ (owner, 2026-09-01).
//
// Owner: *"personel de giriş çıkış yapabilsin pdks gibi değil de en azından saat kaçta girdi çıktı
// görsek yeterli."*
//
// Turnikeden ayrı, bilerek: personel gün içinde defalarca geçiyor (kargo, öğle, komşu dükkân) ve
// her geçişi mesai saymak "saat kaçta geldi" sorusunu otuz satıra çevirir. Geçiş sürtünmesiz kalır,
// vardiya günde iki kez bilinçli olarak yazılır.
export default async function MesaiPage() {
  const ctx = await requirePageAccess('/mesai')
  const bugun = studioToday()
  const view = await loadShiftView(ctx, bugun)
  return <MesaiScreen view={view} ownerMu={ctx.actor.type === 'owner' || ctx.actor.type === 'platform_admin'} />
}
