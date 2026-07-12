import type { HolidayProvider, LocalDate, ProviderHoliday } from '@studio/core'

// D23.1 — an ADAPTER behind the `HolidayProvider` port.
//
// The domain knows the port and nothing else, so this file can be swapped for a government feed,
// a paid API, or a different country without a single domain change. What the domain gets back is
// SNAPSHOTTED into `StudioCalendarDay`, so even if this table is later corrected, a closure that
// was already applied against the old calendar does not move.
//
// Two honest notes about the data:
//
//   • The **fixed** national holidays are law and do not move.
//   • The **religious** holidays (Ramazan / Kurban) follow the lunar calendar. Their civil dates
//     are announced, not computed, so they live in a TABLE here. A year that is not in the table
//     imports the fixed holidays only, and says so — it does not guess. The owner can always add
//     or correct a day by hand, and a manual day is never overwritten by a later import.

const fixed = (year: number): readonly ProviderHoliday[] => {
  const d = (m: number, day: number) =>
    `${year}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}` as LocalDate
  return [
    { externalId: `tr-${year}-yilbasi`, dateFrom: d(1, 1), dateTo: d(1, 1), type: 'public_holiday', title: 'Yılbaşı' },
    { externalId: `tr-${year}-23nisan`, dateFrom: d(4, 23), dateTo: d(4, 23), type: 'public_holiday', title: 'Ulusal Egemenlik ve Çocuk Bayramı' },
    { externalId: `tr-${year}-1mayis`, dateFrom: d(5, 1), dateTo: d(5, 1), type: 'public_holiday', title: 'Emek ve Dayanışma Günü' },
    { externalId: `tr-${year}-19mayis`, dateFrom: d(5, 19), dateTo: d(5, 19), type: 'public_holiday', title: 'Atatürk’ü Anma, Gençlik ve Spor Bayramı' },
    { externalId: `tr-${year}-15temmuz`, dateFrom: d(7, 15), dateTo: d(7, 15), type: 'public_holiday', title: 'Demokrasi ve Millî Birlik Günü' },
    { externalId: `tr-${year}-30agustos`, dateFrom: d(8, 30), dateTo: d(8, 30), type: 'public_holiday', title: 'Zafer Bayramı' },
    { externalId: `tr-${year}-28ekim`, dateFrom: d(10, 28), dateTo: d(10, 28), type: 'public_holiday_half', title: 'Cumhuriyet Bayramı (yarım gün)' },
    { externalId: `tr-${year}-29ekim`, dateFrom: d(10, 29), dateTo: d(10, 29), type: 'public_holiday', title: 'Cumhuriyet Bayramı' },
  ]
}

// Announced civil dates. Arife (the eve) is a half-day; the bayram itself is a full holiday.
const RELIGIOUS: Record<number, readonly ProviderHoliday[]> = {
  2026: [
    { externalId: 'tr-2026-ramazan-arife', dateFrom: '2026-03-19' as LocalDate, dateTo: '2026-03-19' as LocalDate, type: 'public_holiday_half', title: 'Ramazan Bayramı Arifesi (yarım gün)' },
    { externalId: 'tr-2026-ramazan', dateFrom: '2026-03-20' as LocalDate, dateTo: '2026-03-22' as LocalDate, type: 'religious_holiday', title: 'Ramazan Bayramı' },
    { externalId: 'tr-2026-kurban-arife', dateFrom: '2026-05-26' as LocalDate, dateTo: '2026-05-26' as LocalDate, type: 'public_holiday_half', title: 'Kurban Bayramı Arifesi (yarım gün)' },
    { externalId: 'tr-2026-kurban', dateFrom: '2026-05-27' as LocalDate, dateTo: '2026-05-30' as LocalDate, type: 'religious_holiday', title: 'Kurban Bayramı' },
  ],
  2027: [
    { externalId: 'tr-2027-ramazan-arife', dateFrom: '2027-03-08' as LocalDate, dateTo: '2027-03-08' as LocalDate, type: 'public_holiday_half', title: 'Ramazan Bayramı Arifesi (yarım gün)' },
    { externalId: 'tr-2027-ramazan', dateFrom: '2027-03-09' as LocalDate, dateTo: '2027-03-11' as LocalDate, type: 'religious_holiday', title: 'Ramazan Bayramı' },
    { externalId: 'tr-2027-kurban-arife', dateFrom: '2027-05-15' as LocalDate, dateTo: '2027-05-15' as LocalDate, type: 'public_holiday_half', title: 'Kurban Bayramı Arifesi (yarım gün)' },
    { externalId: 'tr-2027-kurban', dateFrom: '2027-05-16' as LocalDate, dateTo: '2027-05-19' as LocalDate, type: 'religious_holiday', title: 'Kurban Bayramı' },
  ],
}

export const turkeyHolidayProvider: HolidayProvider = {
  name: 'tr-official',
  async listHolidays(country: string, year: number): Promise<readonly ProviderHoliday[]> {
    if (country !== 'TR') return []
    return [...fixed(year), ...(RELIGIOUS[year] ?? [])]
  },
}

// Which years this adapter can speak about with religious holidays included. The UI says so
// rather than silently importing an incomplete year.
export const yearsWithReligiousHolidays = Object.keys(RELIGIOUS).map(Number)
