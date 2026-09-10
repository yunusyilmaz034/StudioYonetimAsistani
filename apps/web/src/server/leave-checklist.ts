import type { TenantContext } from '@studio/core'
import { FirestoreIdentityRepository, FirestoreSchedulingRepository, FirestoreStaffLeaveRepository } from '@studio/core'

import { adminDb } from './firebase-admin'
import type { AdvisorItem } from './advisor-query'

// ── EĞİTMENSİZ KALAN DERSLER, PANODA (owner onayı, 2026-09-11) ──────────────────────────────
//
// İzin sisteminin TEK operasyonel çıktısı bu. Bir izin kaydı kendi başına hiçbir kararı
// değiştirmez; değiştiren şey **o gün hangi derslerin sahipsiz kaldığı**.
//
// Panoya izinlerin kendisi DEĞİL, etkilenen DERSLER düşüyor — ve fark önemli: "Ayşe 12–15 izinli"
// bir bilgi, "Perşembe 14:00 Reformer eğitmensiz" bir iştir. Panonun işi haber vermek değil, bugün
// dokunulması gerekeni söylemek.
//
// Karar bekleyen talepler de ayrı bir satır olarak çıkıyor: cevaplanmayan bir izin talebi, planı
// yapılamayan bir hafta demek.

const GUN = 86_400_000
/** Ne kadar ileriye bakılır. İki hafta, program değiştirmek için yeterli ve panoyu boğmuyor. */
const PENCERE_GUN = 14

export async function leaveAdvisorItems(ctx: TenantContext): Promise<readonly AdvisorItem[]> {
  const db = adminDb()
  const now = Date.now()
  const leaveRepo = new FirestoreStaffLeaveRepository(db)
  const izinler = await leaveRepo.listLeavesOverlapping(ctx, now, now + PENCERE_GUN * GUN)
  if (izinler.length === 0) return []

  const staff = await new FirestoreIdentityRepository(db).listStaff(ctx)
  const ad = new Map(staff.map((s) => [String(s.id), s.displayName]))
  const items: AdvisorItem[] = []

  // 1 · Karar bekleyenler. Cevaplanmayan bir talep, yapılamayan bir plan.
  for (const l of izinler.filter((x) => x.status === 'pending')) {
    const isim = ad.get(String(l.staffUserId)) ?? 'Bir çalışan'
    items.push({
      id: `leave_pending__${l.id}`,
      kind: 'staff_leave',
      severity: 'attention',
      subject: { id: String(l.staffUserId), name: isim },
      title: `${isim} izin bekliyor — ${new Date(l.from as number).toLocaleDateString('tr-TR', { day: '2-digit', month: 'short' })} itibarıyla`,
      detail: 'Talep karar bekliyor. Onaylamadan program yapılamaz.',
      href: '/mesai',
      actionLabel: 'İzinleri aç',
    })
  }

  // 2 · Onaylı izinlerde EĞİTMENSİZ KALAN DERSLER. Asıl iş bu.
  const onayli = izinler.filter((x) => x.status === 'approved')
  if (onayli.length === 0) return items

  const sched = new FirestoreSchedulingRepository(db)
  for (const l of onayli) {
    const isim = ad.get(String(l.staffUserId)) ?? 'Bir çalışan'
    const sessions = await sched.listSessionsForDay(ctx, l.from as never, ((l.to as number) + 1) as never)
    const sahipsiz = sessions.filter((s) => s.status !== 'cancelled' && String(s.trainerId ?? '') === String(l.staffUserId))
    if (sahipsiz.length === 0) continue

    // TEK SATIR, ders başına değil: "Ayşe izinli, 4 dersi var" bir iştir; dört ayrı satır aynı işin
    // dört kopyasıdır ve panoyu okunmaz yapar.
    const ilk = sahipsiz.sort((a, b) => (a.startsAt as number) - (b.startsAt as number))[0]!
    items.push({
      id: `leave_uncovered__${l.id}`,
      kind: 'staff_leave',
      // Bu hafta içindeyse acil: program değiştirmek için kalan gün sayısı azalıyor.
      severity: (l.from as number) - now < 7 * GUN ? 'urgent' : 'attention',
      subject: { id: String(l.staffUserId), name: isim },
      title: `${isim} izinli — ${sahipsiz.length} ders eğitmensiz`,
      detail: `İlki ${new Date(ilk.startsAt as number).toLocaleString('tr-TR', { weekday: 'long', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })} · ${ilk.serviceName}. Yerine eğitmen atayın ya da dersi iptal edin.`,
      href: '/schedule',
      actionLabel: 'Takvimi aç',
    })
  }
  return items
}
