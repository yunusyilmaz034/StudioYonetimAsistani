import 'server-only'

import { FirestoreIdentityRepository, FirestoreStaffShiftRepository, type StaffUserId, type TenantContext } from '@studio/core'

import { adminDb } from './firebase-admin'
import { studioDayRange } from './reservations-query'

// MESAİ EKRANININ OKUMASI (owner, 2026-09-01).
//
// İki soru, ikisi de küçük: *benim açık mesaim var mı* ve *bugün kim kaçta girdi çıktı*. İkincisi
// yalnızca owner'a gösteriliyor — bir hocanın bir başkasının saatini görmesi için bir sebep yok.
//
// İsim burada ekleniyor, olayda değil (#6): olay opak kimliği taşır, `/staff` belgesi ismi.

export interface ShiftRow {
  readonly id: string
  readonly staffUserId: string
  readonly displayName: string
  readonly startedAt: number
  readonly endedAt: number | null
}

export interface ShiftView {
  readonly benimAcik: ShiftRow | null
  /** Owner değilse boş. Ekran bunu "liste yok" diye okur, "bugün kimse çalışmadı" diye değil. */
  readonly gun: readonly ShiftRow[]
}

export async function loadShiftView(ctx: TenantContext, dateStr: string): Promise<ShiftView> {
  const db = adminDb()
  const shifts = new FirestoreStaffShiftRepository(db)
  const ben = String(ctx.actor.id) as StaffUserId
  const [fromMs, toMs] = studioDayRange(dateStr)

  const ownerMu = ctx.actor.type === 'owner' || ctx.actor.type === 'platform_admin'
  const [acik, gunlukler, personel] = await Promise.all([
    shifts.getOpenShift(ctx, ben),
    // Gün listesi yalnızca owner için okunuyor: göstermeyeceğimiz bir şeyi okumak, sızıntının
    // en ucuz hâlidir.
    ownerMu ? shifts.listShifts(ctx, fromMs, toMs) : Promise.resolve([]),
    new FirestoreIdentityRepository(db).listStaff(ctx),
  ])

  const ad = new Map(personel.map((s) => [String(s.id), s.displayName]))
  const satir = (s: { id: string; staffUserId: StaffUserId; startedAt: number; endedAt: number | null }): ShiftRow => ({
    id: s.id,
    staffUserId: String(s.staffUserId),
    displayName: ad.get(String(s.staffUserId)) ?? '—',
    startedAt: Number(s.startedAt),
    endedAt: s.endedAt === null ? null : Number(s.endedAt),
  })

  return {
    benimAcik: acik ? satir(acik) : null,
    gun: gunlukler.map(satir),
  }
}
