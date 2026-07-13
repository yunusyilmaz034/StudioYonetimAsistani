import {
  available,
  saleBalanceDue,
  type CashDrawer,
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

const MEMBER_STATUS: Record<string, string> = {
  active: 'Aktif',
  inactive: 'Pasif',
  deleted: 'Silindi',
}
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
  // What each member owes, from the LEDGER's open sales. `member.stats.balanceDue` was never written
  // by anything — this column used to be a column of zeros (Alpha Review).
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

  const rows = live.map((m) => {
    const own = (byMember.get(m.id as string) ?? [])
      .filter((e) => e.status === 'active' || e.status === 'frozen')
      // Earliest-expiring first — the same order the booking path spends them in, so the package the
      // report names is the package the next class will actually take a credit from.
      .sort((a, b) => a.validUntil - b.validUntil)
    const e = own[0]
    const credits = e?.credits ? available(e.credits) : null

    return [
      m.fullName,
      m.phone as string,
      e?.status === 'frozen' ? 'Dondurulmuş' : (MEMBER_STATUS[m.status] ?? m.status),
      date(m.joinedAt),
      e ? e.productSnapshot.name : '—',
      credits === null ? (e ? 'Süresiz' : '—') : credits,
      e ? date(e.validUntil) : '—',
      m.stats.lastAttendanceAt ? date(m.stats.lastAttendanceAt) : 'Hiç gelmedi',
      lira(debtKurus.get(m.id as string) ?? 0),
    ] as const
  })

  const withPackage = rows.filter((r) => r[4] !== '—').length
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
        'Telefon',
        'Durum',
        'Kayıt tarihi',
        'Aktif paket',
        'Kalan kredi',
        'Bitiş',
        'Son gelişi',
        'Bakiye (₺)',
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
  const presumed = reservations.filter((r) => r.attendanceSource === 'system_default').length

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
