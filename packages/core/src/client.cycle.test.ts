import { describe, expect, it } from 'vitest'

import { averageCycleLength, cycleReading, feelPattern, type FeelEntry } from './client'

// This logic decides what a woman is told about her own body, so the cases that must stay SILENT
// matter as much as the ones that speak. See the note above the functions in `client.ts`.

const DAY = 86_400_000
/** A LocalDate n days before `TODAY`. */
const TODAY = '2026-09-28'
const ago = (n: number): string => new Date(Date.parse(`${TODAY}T00:00:00Z`) - n * DAY).toISOString().slice(0, 10)

describe('averageCycleLength', () => {
  it('needs two starts before it can measure anything', () => {
    expect(averageCycleLength([])).toBeNull()
    expect(averageCycleLength([ago(3)])).toBeNull()
  })

  it('averages the gaps', () => {
    expect(averageCycleLength([ago(60), ago(32), ago(4)])).toBe(28)
    expect(averageCycleLength([ago(64), ago(34), ago(4)])).toBe(30)
  })

  it('ignores a gap no cycle could be — a double entry or a skipped month', () => {
    // 3 days apart (she logged the same period twice) and 90 days apart (she stopped logging).
    expect(averageCycleLength([ago(97), ago(7), ago(4)])).toBeNull()
    // The stray entry must not become the anchor: 28 + 28, not 28 + 3 + 25.
    expect(averageCycleLength([ago(60), ago(32), ago(29), ago(4)])).toBe(28)
  })

  it('does not care about the order she typed them in', () => {
    expect(averageCycleLength([ago(4), ago(60), ago(32)])).toBe(28)
  })
})

describe('cycleReading', () => {
  it('says nothing without an entry, or with only future ones', () => {
    expect(cycleReading([], TODAY)).toBeNull()
    expect(cycleReading(['2026-12-01'], TODAY)).toBeNull()
  })

  it('counts the first day of bleeding as day 1', () => {
    expect(cycleReading([TODAY], TODAY)?.dayOfCycle).toBe(1)
    expect(cycleReading([ago(4)], TODAY)?.dayOfCycle).toBe(5)
  })

  it('will not predict from a single entry, and says so', () => {
    const r = cycleReading([ago(4)], TODAY)!
    expect(r.confidence).toBe('none')
    expect(r.nextExpectedStart).toBeNull()
    expect(r.averageLength).toBe(28) // the fallback, flagged by confidence — never presented as measured
  })

  it('is confident only when three logged cycles agree', () => {
    expect(cycleReading([ago(60), ago(32), ago(4)], TODAY)?.confidence).toBe('good')
    expect(cycleReading([ago(32), ago(4)], TODAY)?.confidence).toBe('low') // one gap is not a pattern
    expect(cycleReading([ago(66), ago(32), ago(4)], TODAY)?.confidence).toBe('low') // 34 then 28 — swings
  })

  it('predicts the next start from her own average', () => {
    const r = cycleReading([ago(60), ago(32), ago(4)], TODAY)!
    expect(r.nextExpectedStart).toBe(ago(-24)) // 4 days in, 28-day cycle → 24 days to go
    expect(r.daysUntilNext).toBe(24)
  })

  it('walks the four phases of a 28-day cycle', () => {
    // Two earlier starts pinned 28 days apart from the current one, so the average stays 28 while
    // only the day under test moves.
    const phaseOnDay = (d: number) => cycleReading([ago(d + 55), ago(d + 27), ago(d - 1)], TODAY)?.phase
    expect(phaseOnDay(1)).toBe('menstrual')
    expect(phaseOnDay(5)).toBe('menstrual')
    expect(phaseOnDay(6)).toBe('follicular')
    expect(phaseOnDay(11)).toBe('follicular')
    expect(phaseOnDay(12)).toBe('ovulatory') // ovulation ≈ day 14, window 12–15
    expect(phaseOnDay(15)).toBe('ovulatory')
    expect(phaseOnDay(16)).toBe('luteal')
    expect(phaseOnDay(28)).toBe('luteal')
  })

  it('moves ovulation when her cycle is longer — the luteal half is the fixed one', () => {
    // 35-day average: ovulation ≈ day 21, so day 16 is still follicular rather than luteal.
    const r = cycleReading([ago(85), ago(50), ago(15)], TODAY)!
    expect(r.averageLength).toBe(35)
    expect(r.phase).toBe('follicular')
  })

  it('stops guessing once the last entry is old news', () => {
    expect(cycleReading([ago(70)], TODAY)).toBeNull()
  })
})

describe('feelPattern', () => {
  // Two clean cycles ending 4 days ago, so "day of cycle" is unambiguous in the fixtures below.
  const starts = [ago(60), ago(32), ago(4)]
  /** A class taken on cycle day `d` of the cycle that started `startAgo` days ago. */
  const feel = (startAgo: number, d: number, f: FeelEntry['feel']): FeelEntry => ({ date: ago(startAgo - (d - 1)), feel: f })

  it('stays silent until there is enough to look at', () => {
    const few = [feel(32, 20, 'hard'), feel(32, 22, 'hard'), feel(32, 24, 'hard')]
    expect(feelPattern(starts, few, TODAY)).toBeNull()
  })

  it('stays silent when every phase feels the same', () => {
    const even: FeelEntry[] = [
      feel(32, 8, 'hard'), feel(32, 10, 'normal'), feel(32, 12, 'hard'),
      feel(32, 20, 'hard'), feel(32, 22, 'normal'), feel(32, 24, 'hard'),
    ]
    expect(feelPattern(starts, even, TODAY)).toBeNull()
  })

  it('speaks when one phase is clearly harder, and shows how much it is standing on', () => {
    const luteal: FeelEntry[] = [
      feel(32, 20, 'hard'), feel(32, 22, 'hard'), feel(32, 24, 'hard'),
      feel(60, 21, 'hard'),
      feel(32, 8, 'good'), feel(32, 10, 'normal'), feel(60, 9, 'good'),
    ]
    const p = feelPattern(starts, luteal, TODAY)!
    expect(p.phase).toBe('luteal')
    expect(p.hardRate).toBe(1)
    expect(p.samples).toBe(4)
    expect(p.isNow).toBe(false) // she is on day 5 today — menstrual, not luteal
  })

  it('knows when she is in that phase right now', () => {
    // Today is day 20 of the current cycle, and the luteal classes are the hard ones.
    const current = [ago(79), ago(51), ago(19)]
    const f = (startAgo: number, d: number, x: FeelEntry['feel']): FeelEntry => ({ date: ago(startAgo - (d - 1)), feel: x })
    const luteal: FeelEntry[] = [
      f(51, 20, 'hard'), f(51, 22, 'hard'), f(51, 24, 'hard'),
      f(79, 21, 'hard'),
      f(51, 8, 'good'), f(51, 10, 'normal'), f(79, 9, 'good'),
    ]
    expect(feelPattern(current, luteal, TODAY)?.isNow).toBe(true)
  })

  it('will not claim a cycle pattern when every rated class sits in one phase', () => {
    const onlyLuteal: FeelEntry[] = [
      feel(32, 20, 'hard'), feel(32, 21, 'hard'), feel(32, 22, 'hard'),
      feel(60, 20, 'hard'), feel(60, 21, 'hard'), feel(60, 22, 'normal'),
    ]
    expect(feelPattern(starts, onlyLuteal, TODAY)).toBeNull()
  })

  it('ignores classes taken before she ever logged a period', () => {
    const older: FeelEntry[] = [
      { date: ago(200), feel: 'hard' }, { date: ago(190), feel: 'hard' }, { date: ago(180), feel: 'hard' },
      feel(32, 20, 'hard'), feel(32, 22, 'hard'), feel(32, 8, 'good'),
    ]
    expect(feelPattern(starts, older, TODAY)).toBeNull() // only 3 usable ratings remain
  })

  it('needs a period log before it can say anything at all', () => {
    expect(feelPattern([], [feel(32, 20, 'hard')], TODAY)).toBeNull()
  })
})
