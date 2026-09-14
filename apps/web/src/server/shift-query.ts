import 'server-only'

import {
  FirestoreCheckinRepository,
  FirestoreIdentityRepository,
  FirestoreStaffShiftRepository,
  type StaffUserId,
  type TenantContext,
} from '@studio/core'
import { Timestamp } from 'firebase-admin/firestore'

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
  /** Son turnike geçişi. `null` ⇒ elle açılmış bir vardiya. */
  readonly lastCrossingAt: number | null
}

/** Tek bir turnike geçişi (`staff.crossed`). Yön yalnızca biliniyorsa yazılır (#11). */
export interface CrossingRow {
  readonly at: number
  readonly direction: 'in' | 'out' | null
  readonly deviceName: string | null
}

/** Bir personelin seçilen günü: vardiya(lar)ı ve o günkü bütün geçişleri, saat sırasıyla. */
export interface StaffDayRow {
  readonly staffUserId: string
  readonly displayName: string
  readonly shifts: readonly ShiftRow[]
  readonly crossings: readonly CrossingRow[]
}

export interface ShiftView {
  readonly benimAcik: ShiftRow | null
  /** Listenin günü, 'YYYY-MM-DD' (stüdyonun yerel günü). */
  readonly tarih: string
  /**
   * GÜNLÜK GİRİŞ-ÇIKIŞLAR (owner, 2026-09-14 · OR-77 · iş 1). Owner değilse boş — ekran bunu "liste yok"
   * diye okur, "o gün kimse çalışmadı" diye değil.
   */
  readonly gunluk: readonly StaffDayRow[]
  /**
   * Stüdyoda çalışan bir turnike var mı? (OR-74) Varsa mesai turnikeden türetilir ve elle
   * başlat/bitir düğmeleri GÖSTERİLMEZ: ikisi yan yana dururken 17:00'de elle biten bir mesai,
   * 17:02'deki çıkış geçişiyle yeniden açılırdı.
   */
  readonly turnikeVar: boolean
}

export async function loadShiftView(ctx: TenantContext, dateStr: string): Promise<ShiftView> {
  const db = adminDb()
  const shifts = new FirestoreStaffShiftRepository(db)
  const ben = String(ctx.actor.id) as StaffUserId
  const [fromMs, toMs] = studioDayRange(dateStr)

  const ownerMu = ctx.actor.type === 'owner' || ctx.actor.type === 'platform_admin'
  const [acik, gunlukler, gecisler, personel, cihazlar] = await Promise.all([
    shifts.getOpenShift(ctx, ben),
    // Gün listesi yalnızca owner için okunuyor: göstermeyeceğimiz bir şeyi okumak, sızıntının
    // en ucuz hâlidir.
    ownerMu ? shifts.listShifts(ctx, fromMs, toMs) : Promise.resolve([]),
    // GÜNÜN GEÇİŞLERİ. İndeks YENİ DEĞİL: `(type ASC, recordedAt DESC)` zaten canlıda — ve sıralama
    // yönü indeksinkiyle AYNI (desc). Ters yön, emülatörde geçen ama canlıda "requires an index"
    // diye düşen bir sorgu olurdu. Personel geçişi anında yazıldığı için `recordedAt` günü doğru çizer.
    ownerMu
      ? db
          .collection('studios')
          .doc(ctx.studioId)
          .collection('events')
          .where('type', '==', 'staff.crossed')
          .where('recordedAt', '>=', Timestamp.fromMillis(fromMs))
          .where('recordedAt', '<', Timestamp.fromMillis(toMs))
          .orderBy('recordedAt', 'desc')
          .limit(500)
          .get()
          .then((s) => s.docs)
      : Promise.resolve([]),
    new FirestoreIdentityRepository(db).listStaff(ctx),
    new FirestoreCheckinRepository(db).listDevices(ctx),
  ])

  const ad = new Map(personel.map((s) => [String(s.id), s.displayName]))
  const cihazAdi = new Map(cihazlar.map((d) => [String(d.id), d.name]))
  const satir = (s: {
    id: string
    staffUserId: StaffUserId
    startedAt: number
    endedAt: number | null
    lastCrossingAt: number | null
  }): ShiftRow => ({
    id: s.id,
    staffUserId: String(s.staffUserId),
    displayName: ad.get(String(s.staffUserId)) ?? '—',
    startedAt: Number(s.startedAt),
    endedAt: s.endedAt === null ? null : Number(s.endedAt),
    lastCrossingAt: s.lastCrossingAt === null ? null : Number(s.lastCrossingAt),
  })

  // Personel başına grupla: vardiyası olup geçişi olmayan (elle açılmış) ve geçişi olup o gün başlamış
  // vardiyası olmayan (dünden açık kalmış) biri de listede görünür.
  const gruplar = new Map<string, { shifts: ShiftRow[]; crossings: CrossingRow[] }>()
  const grup = (id: string) => {
    let g = gruplar.get(id)
    if (!g) gruplar.set(id, (g = { shifts: [], crossings: [] }))
    return g
  }
  for (const s of gunlukler) grup(String(s.staffUserId)).shifts.push(satir(s))
  for (const d of gecisler) {
    const id = String(d.get('payload.staffUserId') ?? '')
    if (!id) continue
    const zaman = d.get('occurredAt') as Timestamp | number | null
    const at = zaman instanceof Timestamp ? zaman.toMillis() : Number(zaman ?? 0)
    const yon = d.get('payload.direction') as 'in' | 'out' | null | undefined
    const cihaz = String(d.get('payload.deviceId') ?? '')
    grup(id).crossings.push({ at, direction: yon ?? null, deviceName: cihazAdi.get(cihaz) ?? null })
  }
  const ilkHareket = (g: { shifts: ShiftRow[]; crossings: CrossingRow[] }) =>
    Math.min(...g.shifts.map((s) => s.startedAt), ...g.crossings.map((c) => c.at))
  const gunluk: StaffDayRow[] = [...gruplar]
    .map(([staffUserId, g]) => ({
      staffUserId,
      displayName: ad.get(staffUserId) ?? '—',
      shifts: g.shifts.sort((a, b) => a.startedAt - b.startedAt),
      crossings: g.crossings.sort((a, b) => a.at - b.at),
    }))
    .sort((a, b) => ilkHareket(a) - ilkHareket(b))

  return {
    benimAcik: acik ? satir(acik) : null,
    tarih: dateStr,
    gunluk,
    turnikeVar: cihazlar.some((d) => d.active),
  }
}
