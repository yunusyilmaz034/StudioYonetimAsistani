// D23 — the one place the UI translates a calendar day type. The label and the colour live
// together so a day reads the same on the Studio Calendar, the Class Calendar and inside the
// week-duplication preview. The colour is never the only signal — the type is always written out.

export interface DayMark {
  readonly id: string
  readonly dateFrom: string
  readonly dateTo: string
  readonly type: string
  readonly title: string
}

export const DAY_TYPE_LABEL: Record<string, string> = {
  public_holiday: 'Resmî Tatil',
  public_holiday_half: 'Yarım Gün Tatil',
  religious_holiday: 'Bayram',
  studio_closed: 'Stüdyo Kapalı',
  maintenance: 'Bakım',
  trainer_training: 'Eğitmen Eğitimi',
  special_event: 'Özel Etkinlik',
  special_working_day: 'Özel Çalışma Günü',
}

export const DAY_TYPE_CHIP: Record<string, string> = {
  public_holiday: 'bg-info/10 text-info',
  public_holiday_half: 'bg-info/10 text-info',
  religious_holiday: 'bg-info/10 text-info',
  studio_closed: 'bg-danger/10 text-danger',
  maintenance: 'bg-warning/10 text-warning',
  trainer_training: 'bg-warning/10 text-warning',
  special_event: 'bg-primary-soft text-primary',
  special_working_day: 'bg-success/10 text-success',
}

// The types that mean "we are not running classes here". A public holiday is NOT one of them —
// that is a fact about the country, not a decision by the studio. Plenty of studios open on 1 May.
export const CLOSED_DAY_TYPES = ['studio_closed', 'maintenance']

export const isClosedType = (type: string): boolean => CLOSED_DAY_TYPES.includes(type)

// Every mark covering a given 'YYYY-MM-DD'. A mark may span days (dateFrom..dateTo).
export function marksOn(days: readonly DayMark[], date: string): readonly DayMark[] {
  return days.filter((d) => d.dateFrom <= date && d.dateTo >= date)
}
