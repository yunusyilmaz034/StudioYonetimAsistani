import {
  available,
  money,
  saleBalanceDue,
  type CashDrawer,
  type CheckIn,
  type ClassSession,
  type DailyReadModel,
  type Entitlement,
  type Member,
  type Money,
  type Payment,
  type Reservation,
  type Sale,
  type StaffMember,
} from '@studio/core'

import { formatDateTime } from '@/lib/datetime'
import { memberStateOf, STATE_LABEL } from '@/lib/members/filters'
import type { ExportableTable } from '@/lib/widgets/contract'

// THE REPORT BUILDERS (v1.27 S6) — pure. Data in, `ExportableTable` out.
//
// They are pure for the reason every decision function in this system is pure: a report that can only
// be checked by opening a screen and squinting at it is a report nobody checks. These are tested with
// tables of rows, and the tests are the specification of what each column means.
//
// ── Money ───────────────────────────────────────────────────────────────────────────────────
// Kuruş inside, LIRA as a NUMBER in the cell — `1234.5`, never `'1.234,50 ₺'`. A currency-formatted
// string lands in Excel as text and the owner's SUM() silently returns zero. The column header carries
// the ₺; the cell carries a number she can add up.
//
// ── The one number that is not what it looks like ───────────────────────────────────────────
// Sales are counted on `soldAt` (what was AGREED) and collections on `receivedAt` (what was PAID).
// They are different questions, and answering one with the other is how a studio believes it had a
// good month. The two reports are separate for exactly that reason, and the summary of each says
// which one it is.

export interface Report {
  readonly table: ExportableTable
  readonly summary: string // one Turkish sentence, said out loud
}

// `Money` is an integer number of kuruş with a currency — the brand exists precisely so a float can
// never get into a money path. These two are the ONLY place it is unwrapped: at the very edge, on the
// way into a cell.
const kurus = (m: Money | number): number => (typeof m === 'number' ? m : m.amount)
const lira = (m: Money | number): number => Math.round(kurus(m)) / 100
const tl = (m: Money | number): string =>
  `${lira(m).toLocaleString('tr-TR', { maximumFractionDigits: 2 })} ₺`
const date = (ms: number): string => formatDateTime(ms)
const pct = (n: number, of: number): number => (of === 0 ? 0 : Math.round((n / of) * 100))

// The member's state is DERIVED (Aktif · Duraklatılmış · Pasif) by the same shared function the
// members list uses — a report that calls someone Aktif while the screen calls her Duraklatılmış is
// the drift this taxonomy exists to end. Only the tombstone has its own word.
const SALE_STATUS: Record<string, string> = {
  open: 'Açık (tahsilat bekliyor)',
  settled: 'Tahsil edildi',
  cancelled: 'İptal',
}
const METHOD: Record<string, string> = {
  cash: 'Nakit',
  bank_transfer: 'Havale / EFT',
  credit_card: 'Kredi kartı',
  pos: 'POS',
  online: 'Online',
  gift_card: 'Hediye kartı',
}
const RESERVATION_STATUS: Record<string, string> = {
  booked: 'Rezerve',
  cancelled: 'İptal',
  late_cancelled: 'Geç iptal',
  attended: 'Katıldı',
  no_show: 'Gelmedi',
  waitlisted: 'Bekleme listesi',
}
// The distinction the whole event model was built to protect (#11, AD-38): a presumption is not an
// observation. It is spelled out in the report, in the owner's own language, because this is the one
// place she can see how much of her attendance data was actually *seen* by a human.
const SOURCE: Record<string, string> = {
  trainer: 'Eğitmen işaretledi',
  correction: 'Düzeltildi',
  system_default: 'Sistem varsaydı (kimse işaretlemedi)',
  member_checkin: 'Üye girişte okuttu',
}

const nameOf = (members: readonly Member[]): Map<string, string> =>
  new Map(members.map((m) => [m.id as string, m.fullName]))

// A report that says who took the money must say it in a NAME. A raw uid in the "Alan" column is a
// column nobody reads, and a column nobody reads is a column that hides the thing you built it for.
// The `system` actor is named too — it is the one that resolves attendance, and it must be visible
// as itself, never disguised as a person (#11).
const actorName = (staff: readonly StaffMember[]) => {
  const byId = new Map(staff.map((s) => [s.id as string, s.displayName]))
  return (actor: { readonly type: string; readonly id: unknown } | null): string => {
    if (!actor) return '—'
    if (actor.type === 'system') return 'Sistem'
    if (actor.type === 'migration') return 'Aktarım'
    return byId.get(String(actor.id)) ?? String(actor.id)
  }
}

// ── 1. Üyelik ───────────────────────────────────────────────────────────────────────────────
// A photograph of right now, not of a period. Rows are members; the package columns come from her
// entitlements. An ERASED member is not listed: she is not a member any more, and putting a
// tombstone in an export is how a KVKK erasure quietly un-erases itself.
export function buildMembership(
  members: readonly Member[],
  entitlements: readonly Entitlement[],
  nowMs: number,
  // Ne kadar borç, PAKET başına — üye başına değil (owner, 2026-09-02). İki paketi olan bir üyede
  // üye toplamı, satırda adı yazan paketin yanında yanlış duruyordu: paket eskisinin, bakiye
  // yenisinindi. Bir satır tek bir pakete ait olmalı.
  debtKurus: ReadonlyMap<string, number>,
): Report {
  const live = members.filter((m) => !m.erased && m.status !== 'deleted')
  const erasedCount = members.length - members.filter((m) => !m.erased).length

  const byMember = new Map<string, Entitlement[]>()
  for (const e of entitlements) {
    const list = byMember.get(e.memberId as string) ?? []
    list.push(e)
    byMember.set(e.memberId as string, list)
  }

  const DAY = 86_400_000
  const enriched = live.map((m) => {
    const all = byMember.get(m.id as string) ?? []
    const own = all
      .filter((e) => e.status === 'active' || e.status === 'frozen')
      // EN SON ALINAN önce (owner, 2026-09-02). Eskiden en yakın biten seçiliyordu ve gerekçesi
      // sağlamdı: rezervasyon krediyi ondan harcar, yani rapor "bir sonraki dersin düşeceği paketi"
      // adlandırırdı. Ama bu raporun sorduğu soru o değil — başlığında yazıyor: *"kim üye, paketi ne
      // durumda"*. Owner'ın bakarken aradığı şey üyenin **şu anki/son** üyeliği.
      //
      // Fark gerçek: bir üyenin 11 Eylül'de biten eski paketi ve 14 Eylül'de BAŞLAYAN yeni paketi
      // olabiliyor. Eskisi önce harcanır, ama "bu üyenin üyeliği ne" sorusunun cevabı yenisidir.
      // Başlangıç tarihi sütunu tam da bu yüzden eklendi: ileri tarihli bir paket satırda görünür.
      .sort((a, b) => (b.purchasedAt as number) - (a.purchasedAt as number) || a.validUntil - b.validUntil)
    const e = own[0]
    // Her state reads the DATE too: `status` is flipped to expired by the nightly sweep, and this
    // column must not depend on whether that job fired (a frozen package outruns its date by design).
    const liveCount = own.filter(
      (x) => x.status === 'frozen' || (x.status === 'active' && (x.validUntil as number) >= nowMs),
    ).length
    const credits = e?.credits ? available(e.credits) : null
    const kalanGun = e ? Math.max(0, Math.ceil((e.validUntil - nowMs) / DAY)) : null
    // Default sort key: when the member's MOST RECENT subscription was added (any status) — newest first.
    const latestSub = all.reduce((mx, x) => Math.max(mx, x.purchasedAt as number), 0)

    // Column order matches the studio's old system (owner): Üye · Üyelik · Kalan gün · Kredi · Bakiye,
    // then the rest.
    const row = [
      m.fullName,
      e ? e.productSnapshot.name : '—',
      kalanGun === null ? '—' : kalanGun,
      credits === null ? (e ? 'Süresiz' : '—') : credits,
      // O PAKETİN borcu — üyenin toplamı değil. Satırdaki her hücre aynı pakete ait.
      lira(e ? (debtKurus.get(e.id as string) ?? 0) : 0),
      e ? date(e.validFrom) : '—',
      e ? date(e.validUntil) : '—',
      // "Dondurulmuş" is more specific than "Aktif" and the spreadsheet is where detail belongs —
      // it is the same choice the list's badge makes for a frozen member.
      e?.status === 'frozen'
        ? 'Dondurulmuş'
        : m.status === 'deleted'
          ? 'Silindi'
          : STATE_LABEL[memberStateOf(m.status, liveCount)],
      m.phone as string,
      date(m.joinedAt),
      m.stats.lastAttendanceAt ? date(m.stats.lastAttendanceAt) : 'Hiç gelmedi',
    ] as const
    return { latestSub, row }
  })

  // Owner: default order is the most recently ADDED subscription first; members with no subscription
  // (latestSub 0) fall to the bottom.
  enriched.sort((a, b) => b.latestSub - a.latestSub)
  const rows = enriched.map((x) => x.row)

  const withPackage = rows.filter((r) => r[1] !== '—').length
  const expiringSoon = live.filter((m) =>
    (byMember.get(m.id as string) ?? []).some(
      (e) => e.status === 'active' && e.validUntil > nowMs && e.validUntil - nowMs < 14 * 86_400_000,
    ),
  ).length

  return {
    table: {
      name: 'uyelik-raporu',
      columns: [
        'Üye',
        'Aktif paket',
        'Kalan gün',
        'Kalan kredi',
        // "Paket bakiyesi", "Bakiye" değil: bu sütun artık ÜYENİN toplam borcu değil, satırda adı
        // yazan paketin borcu. Adı söylemezse, aynı kelime iki farklı şeyi anlatmış olur.
        'Paket bakiyesi (₺)',
        'Başlangıç',
        'Bitiş',
        'Durum',
        'Telefon',
        'Kayıt tarihi',
        'Son gelişi',
      ],
      rows: rows.map((r) => [...r]),
    },
    summary:
      `${live.length} üye · ${withPackage} tanesinin aktif paketi var · ` +
      `${expiringSoon} paket 14 gün içinde bitiyor` +
      (erasedCount > 0 ? ` · ${erasedCount} anonimleştirilmiş kayıt listelenmedi` : ''),
  }
}

// ── 2. Satış ────────────────────────────────────────────────────────────────────────────────
// What was AGREED in the period. Selling without collecting is legal here (Doc 2), so `Kalan` is a
// column and not an error: it is the money the studio is owed, and it must never be invisible.
export function buildSales(
  sales: readonly Sale[],
  members: readonly Member[],
  staff: readonly StaffMember[],
): Report {
  const names = nameOf(members)
  const who = actorName(staff)
  const live = sales.filter((s) => s.status !== 'cancelled')

  const rows = sales.map((s) => [
    date(s.soldAt),
    names.get(s.memberId as string) ?? '(silinmiş üye)',
    s.lines.map((l) => `${l.description} × ${l.quantity}`).join(' + '),
    lira(s.gross),
    lira(kurus(s.gross) - kurus(s.total)),
    lira(s.total),
    lira(s.paid),
    lira(saleBalanceDue(s)),
    SALE_STATUS[s.status] ?? s.status,
    who(s.soldBy),
  ])

  const total = live.reduce((n, s) => n + kurus(s.total), 0)
  const paid = live.reduce((n, s) => n + kurus(s.paid), 0)
  const due = live.reduce((n, s) => n + kurus(saleBalanceDue(s)), 0)
  const cancelled = sales.length - live.length

  return {
    table: {
      name: 'satis-raporu',
      columns: [
        'Tarih',
        'Üye',
        'Ürünler',
        'Brüt (₺)',
        'İndirim (₺)',
        'Net (₺)',
        'Tahsil edilen (₺)',
        'Kalan (₺)',
        'Durum',
        'Satan',
      ],
      rows,
    },
    summary:
      `${live.length} satış · ${tl(total)} anlaşıldı · ${tl(paid)} tahsil edildi · ` +
      `${tl(due)} bekliyor` +
      (cancelled > 0 ? ` · ${cancelled} iptal (toplamlara girmedi)` : ''),
  }
}

// ── 3. Tahsilat ─────────────────────────────────────────────────────────────────────────────
// What was RECEIVED in the period — the cash-basis number (OQ-2). A voided payment stays on the
// list and out of the total: a payment is never mutated, a mistake is voided (I-31), and a report
// that hides the mistake is a report that cannot be reconciled against the till.
export function buildCollections(
  payments: readonly Payment[],
  members: readonly Member[],
  drawers: readonly CashDrawer[],
  staff: readonly StaffMember[],
): Report {
  const names = nameOf(members)
  const who = actorName(staff)
  const drawerName = new Map(drawers.map((d) => [d.id, d.name]))
  const live = payments.filter((p) => !p.voided)

  const rows = [...payments]
    .sort((a, b) => a.receivedAt - b.receivedAt)
    .map((p) => [
      date(p.receivedAt),
      names.get(p.memberId as string) ?? '(silinmiş üye)',
      lira(p.amount),
      METHOD[p.method] ?? p.method,
      who(p.takenBy),
      p.drawerId ? (drawerName.get(p.drawerId) ?? p.drawerId) : '—',
      p.voided ? `İPTAL — ${p.voidReason ?? ''}`.trim() : 'Geçerli',
    ])

  const total = live.reduce((n, p) => n + kurus(p.amount), 0)
  const byMethod = new Map<string, number>()
  for (const p of live) byMethod.set(p.method, (byMethod.get(p.method) ?? 0) + kurus(p.amount))
  const breakdown = [...byMethod.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([m, n]) => `${METHOD[m] ?? m} ${tl(n)}`)
    .join(' · ')
  const voided = payments.length - live.length

  return {
    table: {
      name: 'tahsilat-raporu',
      columns: ['Tarih', 'Üye', 'Tutar (₺)', 'Yöntem', 'Alan', 'Kasa', 'Durum'],
      rows,
    },
    summary:
      `${live.length} tahsilat · ${tl(total)}` +
      (breakdown ? ` · ${breakdown}` : '') +
      (voided > 0 ? ` · ${voided} iptal edilmiş tahsilat toplama girmedi` : ''),
  }
}

// ── 4. Rezervasyon ──────────────────────────────────────────────────────────────────────────
export function buildReservations(
  reservations: readonly Reservation[],
  sessions: readonly ClassSession[],
): Report {
  const session = new Map(sessions.map((s) => [s.id as string, s]))

  const rows = [...reservations]
    .sort((a, b) => a.sessionStartsAt - b.sessionStartsAt)
    .map((r) => {
      const s = session.get(r.classSessionId as string)
      return [
        date(r.sessionStartsAt),
        s?.serviceName ?? '—',
        s?.trainerName ?? '—',
        // The roster snapshot, not a join: it is what was true when she booked, and it is what a
        // dispute reads (AD-44). It is deliberately a DISPLAY name ("Ayşe Y.") — the reservation
        // carries only what the roster needs, never the whole of her.
        r.memberSnapshot.displayName,
        RESERVATION_STATUS[r.status] ?? r.status,
        r.attendanceSource ? (SOURCE[r.attendanceSource] ?? r.attendanceSource) : '—',
      ]
    })

  const n = (status: string) => reservations.filter((r) => r.status === status).length
  // Same trap as the payroll classification: anything `attended` that a trainer did not mark is a
  // presumption, and naming the sources one by one is how a new one quietly stops being counted.
  const presumed = reservations.filter(
    (r) => r.status === 'attended' && r.attendanceSource !== 'trainer' && r.attendanceSource !== null,
  ).length

  return {
    table: {
      name: 'rezervasyon-raporu',
      columns: ['Ders zamanı', 'Ders', 'Eğitmen', 'Üye', 'Durum', 'Katılım kaynağı'],
      rows,
    },
    summary:
      `${reservations.length} rezervasyon · ${n('attended')} katıldı · ${n('no_show')} gelmedi · ` +
      `${n('cancelled') + n('late_cancelled')} iptal` +
      (presumed > 0
        ? ` · ${presumed} tanesini kimse işaretlemedi, sistem katıldı saydı`
        : ''),
  }
}

// ── 5. Eğitmen ──────────────────────────────────────────────────────────────────────────────
// Sessions the trainer taught, and how full they were. Money is NOT in this report: nothing in the
// system attributes revenue to a trainer yet (a sale records who SOLD it, which is a different
// person and a different question), and a column of numbers that means something other than what its
// header says is worse than a missing column.
export function buildTrainer(
  sessions: readonly ClassSession[],
  reservations: readonly Reservation[],
): Report {
  const bySession = new Map<string, Reservation[]>()
  for (const r of reservations) {
    const list = bySession.get(r.classSessionId as string) ?? []
    list.push(r)
    bySession.set(r.classSessionId as string, list)
  }

  interface Row {
    name: string
    sessions: number
    capacity: number
    booked: number
    attended: number
    noShow: number
  }
  const acc = new Map<string, Row>()
  for (const s of sessions) {
    if (s.status === 'cancelled') continue // a cancelled class was not taught
    const key = (s.trainerId as string | null) ?? '—'
    const row = acc.get(key) ?? {
      name: s.trainerName ?? 'Eğitmen atanmadı',
      sessions: 0,
      capacity: 0,
      booked: 0,
      attended: 0,
      noShow: 0,
    }
    const rs = bySession.get(s.id as string) ?? []
    row.sessions += 1
    row.capacity += s.capacity
    row.booked += rs.filter((r) => r.status !== 'cancelled').length
    row.attended += rs.filter((r) => r.status === 'attended').length
    row.noShow += rs.filter((r) => r.status === 'no_show').length
    acc.set(key, row)
  }

  const rows = [...acc.values()]
    .sort((a, b) => b.sessions - a.sessions)
    .map((r) => [
      r.name,
      r.sessions,
      r.capacity,
      r.booked,
      r.attended,
      r.noShow,
      pct(r.booked, r.capacity),
    ])

  const totalSessions = [...acc.values()].reduce((n, r) => n + r.sessions, 0)
  const totalBooked = [...acc.values()].reduce((n, r) => n + r.booked, 0)
  const totalCap = [...acc.values()].reduce((n, r) => n + r.capacity, 0)

  return {
    table: {
      name: 'egitmen-raporu',
      columns: [
        'Eğitmen',
        'Ders',
        'Kapasite',
        'Rezervasyon',
        'Katılan',
        'Gelmedi',
        'Doluluk (%)',
      ],
      rows,
    },
    summary: `${acc.size} eğitmen · ${totalSessions} ders · ortalama doluluk %${pct(totalBooked, totalCap)}`,
  }
}

// ── 6. Gün sonu ─────────────────────────────────────────────────────────────────────────────
// One day, one page, printable. It is a LIST OF FACTS, not an analysis: what happened, what came in,
// what the till says. The kasa discrepancy is on it because a discrepancy is recorded, never
// absorbed — and the day it is not on the day-end report is the day nobody looks at it.
export function buildDayEnd(
  dateLabel: string,
  daily: DailyReadModel | null,
  payments: readonly Payment[],
  sales: readonly Sale[],
  drawers: readonly CashDrawer[],
): Report {
  const live = payments.filter((p) => !p.voided)
  const collected = live.reduce((n, p) => n + kurus(p.amount), 0)
  const sold = sales.filter((s) => s.status !== 'cancelled').reduce((n, s) => n + kurus(s.total), 0)

  const byMethod = new Map<string, number>()
  for (const p of live) byMethod.set(p.method, (byMethod.get(p.method) ?? 0) + kurus(p.amount))

  const rows: (string | number)[][] = [
    ['Gün', dateLabel],
    ['Rezervasyon', daily?.bookings ?? 0],
    ['İptal', daily?.cancellations ?? 0],
    ['Check-in', daily?.checkIns ?? 0],
    ['Katılan', daily?.attended ?? 0],
    ['Gelmedi', daily?.noShow ?? 0],
    ['Sistemin katıldı saydığı', daily?.autoResolved ?? 0],
    ['Yeni üye', daily?.newMembers ?? 0],
    ['Satış (₺)', lira(sold)],
    ['Tahsilat (₺)', lira(collected)],
  ]
  for (const [m, n] of [...byMethod.entries()].sort((a, b) => b[1] - a[1])) {
    rows.push([`  ${METHOD[m] ?? m} (₺)`, lira(n)])
  }
  for (const d of drawers) {
    rows.push([`Kasa — ${d.name}`, d.status === 'open' ? 'AÇIK (kapatılmadı)' : 'Kapatıldı'])
    rows.push([`  Beklenen (₺)`, lira(d.expected)])
    if (d.countedAmount !== null) rows.push([`  Sayılan (₺)`, lira(d.countedAmount)])
    if (d.discrepancy !== null && kurus(d.discrepancy) !== 0) {
      rows.push([
        `  Fark (₺)`,
        lira(d.discrepancy),
      ])
      if (d.closeNote) rows.push([`  Fark açıklaması`, d.closeNote])
    }
  }

  const openDrawers = drawers.filter((d) => d.status === 'open').length
  const discrepancy = drawers.reduce((n, d) => n + (d.discrepancy ? kurus(d.discrepancy) : 0), 0)

  return {
    table: {
      name: `gun-sonu-${dateLabel}`,
      columns: ['Kalem', 'Değer'],
      rows,
    },
    summary:
      `${dateLabel}: ${daily?.attended ?? 0} katılım · ${tl(collected)} tahsilat` +
      (openDrawers > 0 ? ` · ${openDrawers} kasa hâlâ AÇIK` : '') +
      (discrepancy !== 0 ? ` · kasa farkı ${tl(discrepancy)}` : ''),
  }
}

// ── 7. Kasa ─────────────────────────────────────────────────────────────────────────────────
export function buildCash(drawers: readonly CashDrawer[], staff: readonly StaffMember[]): Report {
  const who = actorName(staff)
  const rows = [...drawers]
    .sort((a, b) => (b.openedAt ?? 0) - (a.openedAt ?? 0))
    .map((d) => [
      d.name,
      d.kind === 'cash' ? 'Nakit' : 'POS',
      d.status === 'open' ? 'Açık' : 'Kapalı',
      d.openedAt ? date(d.openedAt) : '—',
      d.closedAt ? date(d.closedAt) : '—',
      who(d.openedBy),
      who(d.closedBy),
      lira(d.openingFloat),
      lira(d.expected),
      d.countedAmount === null ? '—' : lira(d.countedAmount),
      d.discrepancy === null ? '—' : lira(d.discrepancy),
      d.closeNote ?? '',
    ])

  const closed = drawers.filter((d) => d.status !== 'open')
  const off = closed.filter((d) => (d.discrepancy ? kurus(d.discrepancy) : 0) !== 0)
  const total = off.reduce((n, d) => n + (d.discrepancy ? kurus(d.discrepancy) : 0), 0)

  return {
    table: {
      name: 'kasa-raporu',
      columns: [
        'Kasa',
        'Tür',
        'Durum',
        'Açılış',
        'Kapanış',
        'Açan',
        'Kapatan',
        'Başlangıç (₺)',
        'Beklenen (₺)',
        'Sayılan (₺)',
        'Fark (₺)',
        'Açıklama',
      ],
      rows,
    },
    summary:
      `${drawers.length} kasa · ${closed.length} kapatıldı · ` +
      (off.length === 0
        ? 'hiçbirinde fark yok'
        : `${off.length} kasada fark var, toplam ${tl(total)}`),
  }
}


// ── 9. BORÇLULAR (owner, 2026-09-05) ────────────────────────────────────────────────────────
//
// *"Borçluların listesini de göreyim, açık tahsilatlar o nerede."* Panoda satır satır vardı ama tek
// bir liste yoktu: resepsiyon kimi arayacağını görmek için satırları tek tek açmak zorundaydı.
//
// TARİH ARALIĞINDAN ETKİLENMEZ. Borç bir dönem değil, BUGÜNKÜ DURUMDUR — "son 7 gün" seçen biri eski
// borçları görmeseydi, borcun kapandığını sanardı.
//
// SIRA: en ESKİ borç önde. Tutar değil, BEKLEME SÜRESİ sıralıyor — 300 ₺'lik iki aylık bir borç,
// dünkü 5.000 ₺'den daha acil bir konuşmadır, çünkü zaman geçtikçe tahsil edilme ihtimali düşer.
export function buildDebts(sales: readonly Sale[], members: readonly Member[], now: number): Report {
  const names = nameOf(members)
  const phones = new Map(members.map((m) => [m.id as string, m.phone as string]))
  const open = sales.filter((s) => s.status !== 'cancelled' && saleBalanceDue(s) > 0)

  const rows = [...open]
    .sort((a, b) => a.soldAt - b.soldAt)
    .map((s) => {
      const due = saleBalanceDue(s)
      const gun = Math.max(0, Math.floor((now - Number(s.soldAt)) / 86_400_000))
      return [
        date(s.soldAt),
        names.get(s.memberId as string) ?? '(silinmiş üye)',
        phones.get(s.memberId as string) ?? '—',
        s.lines.map((l) => l.description).join(', '),
        lira(s.total),
        lira(s.paid),
        lira(money(due)),
        gun,
      ]
    })

  const toplam = open.reduce((n, s) => n + saleBalanceDue(s), 0)
  // ÜYE SAYISI, SATIŞ SAYISI DEĞİL: "13 açık bakiye" cümlesi kaç KİŞİYİ arayacağını söylemeli; bir
  // üyenin iki açık satışı varsa o iki telefon görüşmesi değil, birdir.
  const kisi = new Set(open.map((s) => s.memberId as string)).size
  const enEski = open.length > 0 ? Math.max(...open.map((s) => Math.floor((now - Number(s.soldAt)) / 86_400_000))) : 0

  return {
    table: {
      name: 'borclular',
      columns: ['Satış tarihi', 'Üye', 'Telefon', 'Ürünler', 'Tutar (₺)', 'Tahsil edilen (₺)', 'Kalan (₺)', 'Gün'],
      rows,
    },
    summary:
      open.length === 0
        ? 'Açık bakiye yok — herkesin hesabı kapalı.'
        : `${kisi} üye · ${open.length} açık satış · ${tl(toplam)} bekliyor · en eskisi ${enEski} gündür.`,
  }
}

// ── Check-in (owner, 2026-09-15) ────────────────────────────────────────────────────────────
//
// Üç ayrı rapor (günlük/haftalık/aylık) vardı; owner 17 Eylül'de kaldırttı: *"üstteki check-in günlük haftalık
// aylık olmasına gerek yok, altta filtre var zaten."* Haklıydı — aralık seçicisi zaten dönemi belirliyordu.
// TEK rapor: satır = bir üye, seçilen aralıkta kaç kez girdi, ilk girişi ve son çıkışı, hangi yoldan. Yalnızca
// GİRİŞLER sayılır; çıkış bir ziyaret değildir. Gün sınırı stüdyo saatiyle (UTC+3).

const TR_MS = 3 * 3_600_000
const GUN_MS = 86_400_000
const VIA: Record<string, string> = { device: 'Turnike', qr: 'QR', reception: 'Resepsiyon' }
const iki = (n: number) => String(n).padStart(2, '0')
/** Stüdyo gününün "yerel" başlangıcı — UTC alanları doğrudan İstanbul tarihini verir. */
const yerelGun = (ms: number) => Math.floor((ms + TR_MS) / GUN_MS) * GUN_MS
const gunAy = (yerel: number) => {
  const d = new Date(yerel)
  return `${iki(d.getUTCDate())}.${iki(d.getUTCMonth() + 1)}`
}


// KIRMIZI LİSTE (owner, 2026-09-17) — kim, kaç kez iptal etti.
//
// Sayım İPTAL ANINA göre (`resolvedAt`), dersin saatine göre DEĞİL: bugün iptal edilen bir ders
// gelecek haftaya ait olabilir, ve "bu ay kaç kez iptal etti" sorusunun cevabı iptal anıdır.
//
// "Bugün" ve "son 7 gün" sütunları seçilen aralıktan bağımsızdır — `now`'a göre hesaplanır. Aralık
// neyin SAYILDIĞINI belirler (varsayılan 30 gün), bu iki sütun ise "yine mi" sorusunu cevaplar.
export function buildCancellations(
  cancelled: readonly Reservation[],
  members: readonly Member[],
  now: number,
): Report {
  const name = new Map(members.map((m) => [m.id as string, m.fullName]))
  const DAY = 86_400_000
  const gunBasi = now - (now % DAY) // kaba gün başı; sütun "bugün mü" ayrımı için yeterli
  const acc = new Map<string, { today: number; week: number; total: number; late: number; last: number }>()
  for (const r of cancelled) {
    const at = (r.resolvedAt ?? 0) as number
    if (at === 0) continue
    const id = r.memberId as string
    const row = acc.get(id) ?? { today: 0, week: 0, total: 0, late: 0, last: 0 }
    row.total++
    if (at >= gunBasi) row.today++
    if (at >= now - 7 * DAY) row.week++
    // Kredisi yanan iptal = geç iptal. Ayrı sütun, çünkü ikisi aynı davranış değil.
    if (r.creditEffect === 'consumed') row.late++
    if (at > row.last) row.last = at
    acc.set(id, row)
  }
  const satirlar = [...acc.entries()].sort(
    (a, b) => b[1].total - a[1].total || b[1].late - a[1].late || b[1].last - a[1].last,
  )
  const cokIptal = satirlar.filter(([, v]) => v.total >= 3).length
  return {
    table: {
      name: 'kirmizi-liste',
      columns: ['Üye', 'Bugün', 'Son 7 gün', 'Dönem toplamı', 'Geç iptal', 'Son iptal'],
      rows: satirlar.map(([id, v]) => [
        name.get(id) ?? 'Silinmiş üye',
        v.today,
        v.week,
        v.total,
        v.late,
        date(v.last),
      ]),
    },
    summary:
      satirlar.length === 0
        ? 'Bu dönemde iptal yok.'
        : `${satirlar.length} üye toplam ${satirlar.reduce((n, [, v]) => n + v.total, 0)} ders iptal etti` +
          (cokIptal > 0 ? ` — ${cokIptal} üye 3 veya daha fazla.` : '.'),
  }
}

export function buildCheckins(checkIns: readonly CheckIn[], members: readonly Member[]): Report {
  const name = new Map(members.map((m) => [m.id as string, m.fullName]))
  const sirali = [...checkIns].sort((a, b) => a.occurredAt - b.occurredAt)
  const acc = new Map<
    string,
    { memberId: string; count: number; first: number | null; lastOut: number | null; via: Set<string> }
  >()
  const gunluk = new Map<number, number>()
  for (const c of sirali) {
    const id = c.memberId as string
    const row = acc.get(id) ?? { memberId: id, count: 0, first: null, lastOut: null, via: new Set<string>() }
    if (c.direction === 'in') {
      row.count++
      row.first ??= c.occurredAt
      row.via.add(c.method)
      const g = yerelGun(c.occurredAt)
      gunluk.set(g, (gunluk.get(g) ?? 0) + 1)
    } else {
      row.lastOut = c.occurredAt
    }
    acc.set(id, row)
  }
  const satirlar = [...acc.values()].sort(
    (a, b) => b.count - a.count || (name.get(a.memberId) ?? '').localeCompare(name.get(b.memberId) ?? '', 'tr'),
  )
  const girisler = sirali.filter((c) => c.direction === 'in')
  // GÜN GÜN TOPLAM (owner, 2026-09-17): *"dün 15, bugün 10, 2 gün içinde 25 gibi."* Aralığın toplamı
  // tek başına "yoğun muyduk" sorusunu cevaplamıyor; hangi günün kalabalık olduğu cevaplıyor.
  // Uzun aralıkta cümle okunmaz hale gelmesin diye ilk 14 gün yazılır, gerisi sayıyla özetlenir.
  const gunler = [...gunluk.entries()].sort((a, b) => a[0] - b[0])
  const gosterilen = gunler.slice(0, 14).map(([g, n]) => `${gunAy(g)}: ${n}`)
  const kalan = gunler.length - gosterilen.length
  const dagilim = gunler.length === 0 ? '' : `${gosterilen.join(' · ')}${kalan > 0 ? ` · +${kalan} gün daha` : ''}`
  return {
    table: {
      name: 'check-in-raporu',
      columns: ['Üye', 'Giriş sayısı', 'İlk giriş', 'Son çıkış', 'Giriş yolu'],
      rows: satirlar.map((s) => [
        name.get(s.memberId) ?? 'Silinmiş üye',
        s.count,
        s.first === null ? '—' : date(s.first),
        s.lastOut === null ? '—' : date(s.lastOut),
        [...s.via].map((v) => VIA[v] ?? v).join(' · '),
      ]),
    },
    summary:
      girisler.length === 0
        ? 'Bu aralıkta check-in yok.'
        : `${girisler.length} giriş · ${new Set(girisler.map((c) => c.memberId as string)).size} farklı üye · ` +
          `${gunler.length} gün — ${dagilim}`,
  }
}

// ── NOTLAR (owner, 2026-09-22) ───────────────────────────────────────────────────────────────
//
// *"Şuradaki işlere not ekliyorlar, bunu bir ekran yap da görelim bir yerde."*
//
// Panoda bir işe tik atarken bırakılan not O GÜNÜN belgesinde duruyor (`checklistDone/{gün}`) ve
// ertesi sabah pano yeniden kurulduğu için görünmez oluyordu — not kaybolmuyordu, bakılacak yeri
// yoktu. Burası o yer: aralıktaki bütün notlar, en yeniden eskiye, kim yazmış ve hangi işe.
//
// Satırın "iş" sütunu tik anında donmuş başlıktan gelir; eski kayıtlarda başlık yoksa iş TÜRÜ yazılır,
// çünkü "—" yazmak notu sahipsiz bırakır.
export interface NotSatiri {
  readonly at: number
  readonly byName: string
  readonly kind: string
  readonly subject: string
  readonly title: string
  readonly note: string
}

const NOT_TURU: Record<string, string> = {
  hot_lead: 'WhatsApp adayı',
  outstanding_balance: 'Açık bakiye',
  low_credit: 'Ders hakkı azaldı',
  dormant_member: 'Uzaklaşan üye',
  expiring_with_credits: 'Hakkı yanmak üzere',
  expiring_soon: 'Paketi doluyor',
  door_refused: 'Kapıda kalan',
  leave_pending: 'İzin kararı',
  leave_uncovered: 'Eğitmensiz ders',
  online_payment: 'Kartla ödeme',
  staff_plan: 'Vardiya planı',
}

export function buildNotes(rows: readonly NotSatiri[]): Report {
  const sirali = [...rows].sort((a, b) => b.at - a.at)
  const kisiler = new Set(sirali.map((r) => r.byName))
  const gunler = new Set(sirali.map((r) => new Date(r.at).toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul' })))
  return {
    table: {
      name: 'notlar',
      columns: ['Tarih', 'Yazan', 'İş', 'İlgili', 'Not'],
      rows: sirali.map((r) => [
        date(r.at),
        r.byName,
        // Tik anında donmuş başlık işi olduğu gibi söyler ("Bilgi alıyor: Ayşenur Taş · 5 gündür
        // sessiz"); eski kayıtlarda başlık yok, o zaman tür yazılır — "—" notu sahipsiz bırakırdı.
        r.title || NOT_TURU[r.kind] || r.kind,
        r.subject || '—',
        r.note,
      ]),
    },
    summary:
      sirali.length === 0
        ? 'Bu aralıkta not yazılmamış.'
        : `${sirali.length} not · ${gunler.size} gün · ${kisiler.size} kişi yazdı (${[...kisiler].join(', ')}).`,
  }
}
