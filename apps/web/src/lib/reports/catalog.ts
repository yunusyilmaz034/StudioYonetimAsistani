// THE SEVEN REPORTS (v1.27 S6) — the catalogue, and nothing else.
//
// This file is imported by the SCREEN, so it holds no domain types and no `@studio/core` import: one
// value imported from the kernel drags `firebase-admin` into the browser bundle.
//
// ── Why one screen and not seven ────────────────────────────────────────────────────────────
// A report is columns and rows. That is the whole of it — v1.23 already said so, and put the
// `ExportableTable` contract in to prove it. Seven screens would be seven date pickers, seven
// export buttons, seven places for a column to be wrong. There is one screen, one range, one table,
// one export.
//
// ── Why the owner alone ─────────────────────────────────────────────────────────────────────
// The owner (2026-07-13): reception does not get finance reports, and bulk export is the owner's
// alone. A CSV of any of these is the studio's business — or its members' PII — in one file, in a
// Downloads folder, forever.

export type ReportId =
  | 'membership'
  | 'sales'
  | 'collections'
  | 'reservations'
  | 'trainer'
  | 'dayend'
  | 'cash'

export interface ReportSpec {
  readonly id: ReportId
  readonly label: string
  readonly question: string // the question the owner is actually asking when she opens it
  /**
   * How the date range is used.
   *
   * `range` — rows fall inside it. `day` — a single studio day (the range's first). `state` — the
   * range is IGNORED: the report is a photograph of right now.
   *
   * The screen SAYS which of the three it is, in the report's own words. A date picker that silently
   * does nothing is worse than no date picker: it makes the reader believe a number is about a period
   * when it is about today.
   */
  readonly time: 'range' | 'day' | 'state'
}

export const REPORTS: readonly ReportSpec[] = [
  {
    id: 'membership',
    label: 'Üyelik raporu',
    question: 'Kim üye, paketi ne durumda, ne zaman bitiyor?',
    time: 'state',
  },
  {
    id: 'sales',
    label: 'Satış raporu',
    question: 'Bu dönemde ne sattık, ne kadarı tahsil edildi, ne kadarı bekliyor?',
    time: 'range',
  },
  {
    id: 'collections',
    label: 'Tahsilat raporu',
    question: 'Bu dönemde kasaya ne girdi, hangi yöntemle, kim aldı?',
    time: 'range',
  },
  {
    id: 'reservations',
    label: 'Rezervasyon raporu',
    question: 'Bu dönemde kim hangi derse geldi, kim gelmedi?',
    time: 'range',
  },
  {
    id: 'trainer',
    label: 'Eğitmen raporu',
    question: 'Hangi eğitmen kaç ders verdi, dersleri ne kadar doldu?',
    time: 'range',
  },
  {
    id: 'dayend',
    label: 'Gün sonu raporu',
    question: 'Bugün ne oldu — dersler, gelenler, para, kasa?',
    time: 'day',
  },
  {
    id: 'cash',
    label: 'Kasa raporu',
    question: 'Kasa ne zaman açıldı, ne sayıldı, fark var mı?',
    time: 'range',
  },
]

export const TIME_NOTE: Record<ReportSpec['time'], string> = {
  range: 'Seçilen tarih aralığındaki kayıtlar.',
  day: 'Seçilen aralığın ilk günü — gün sonu tek bir günün raporudur.',
  state: 'Bu rapor tarih aralığından etkilenmez: bugünkü üyelik durumunu gösterir.',
}
