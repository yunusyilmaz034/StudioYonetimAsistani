import { describe, expect, it } from 'vitest'

import { canSee, homeFor, PERMISSIONS, type Area } from './permissions'

// The permission matrix, asserted — because until v1.27 there was no matrix, and every staff page
// asked "are you staff?" while none asked "which role?". A trainer could open the members list, the
// till and the sales funnel. The write actions would have refused her; she could already SEE the
// studio's PII and its money, and reads are what a leak is made of.

const AREAS = Object.keys(PERMISSIONS) as Area[]

describe('the trainer — staff, and the person least entitled to the studio’s data', () => {
  it('sees only her own screens — her classes, the training workspace (Plus Phase 7) and her own pay (Plus Phase 9)', () => {
    // Her classes, the training workspace (the exercise library and her feedback center), and — since
    // Plus Phase 9 — her OWN earnings (read-only, never another trainer's). Still not the members
    // list, the till, the funnel, or the payroll cost side.
    const visible = AREAS.filter((a) => canSee('trainer', a))
    // + the Bilgi Merkezi, which every staff role can read (owner edits it).
    expect(visible).toEqual(['/knowledge', '/my-classes', '/training', '/my-payroll'])
  })

  it('cannot see the studio-wide payroll — it is owner-confidential (Plus Phase 9)', () => {
    expect(canSee('trainer', '/payroll')).toBe(false)
  })

  it('cannot see the members list — the studio’s PII', () => {
    expect(canSee('trainer', '/members')).toBe(false)
  })

  it('cannot see the till, the funnel, or the dashboard', () => {
    expect(canSee('trainer', '/finance')).toBe(false)
    expect(canSee('trainer', '/crm')).toBe(false)
    expect(canSee('trainer', '/')).toBe(false)
  })

  it('lands on her own screen when she signs in — not on a dashboard that bounces her', () => {
    expect(homeFor('trainer')).toBe('/my-classes')
  })
})

describe('the kiosk — the studio’s least-privileged principal, a tablet on a wall', () => {
  it('sees exactly one screen: its own QR scanner, and nothing else', () => {
    const visible = AREAS.filter((a) => canSee('kiosk', a))
    expect(visible).toEqual(['/checkin/kiosk'])
  })

  it('cannot see the DESK check-in screen — that shows who is inside and who is expected, by name', () => {
    expect(canSee('kiosk', '/checkin')).toBe(false)
  })

  it('cannot see members, the till, or the settings — the whole reason it is a separate role', () => {
    for (const area of ['/members', '/finance', '/settings', '/staff', '/'] as const) {
      expect(canSee('kiosk', area), area).toBe(false)
    }
  })

  it('lands on its scanner when it signs in — its one screen is its home', () => {
    expect(homeFor('kiosk')).toBe('/checkin/kiosk')
  })

  it('reception mounts the same kiosk screen from her own session (a spare iPad)', () => {
    expect(canSee('receptionist', '/checkin/kiosk')).toBe(true)
    expect(canSee('owner', '/checkin/kiosk')).toBe(true)
  })
})

describe('reception — she runs the day, and she does not run the business', () => {
  it('has the desk: members, packages, the calendar, the till, check-in, fitness, retail', () => {
    for (const area of ['/', '/members', '/packages', '/schedule', '/checkin', '/fitness', '/finance', '/retail'] as const) {
      expect(canSee('receptionist', area), area).toBe(true)
    }
  })

  it('a trainer does not get the fitness usage screen — it is the studio’s data, not her craft', () => {
    expect(canSee('trainer', '/fitness')).toBe(false)
  })

  it('is refused the audit log, the analytics, the settings, the staff list, and payroll (owner, 2026-07-13)', () => {
    for (const area of ['/audit', '/analytics', '/settings', '/staff', '/payroll', '/my-payroll', '/advisor'] as const) {
      expect(canSee('receptionist', area), area).toBe(false)
    }
  })

  it('is refused bulk operations — they MOVE CREDITS', () => {
    // A closure cancels forty sessions and releases three hundred credits. It is not part of
    // reception's day, and the mandatory reason on it is the owner's to give.
    expect(canSee('receptionist', '/operations')).toBe(false)
  })
})

describe('the owner', () => {
  // The two PERSONAL trainer screens ("Derslerim", "Hakedişim") are not part of the admin panel —
  // the owner manages the studio here and uses her separate TRAINER account for her own teaching day
  // and earnings (owner request, 2026-07-16). Everything else, she sees.
  const TRAINER_PERSONAL = ['/my-classes', '/my-payroll'] as const
  it('sees every management screen — kept out of nothing but the two personal trainer screens', () => {
    for (const area of AREAS) {
      expect(canSee('owner', area), area).toBe(!TRAINER_PERSONAL.includes(area as (typeof TRAINER_PERSONAL)[number]))
    }
  })
})

describe('the matrix itself', () => {
  it('leaves no area unassigned — a screen with no row is a screen with no lock', () => {
    for (const area of AREAS) {
      expect(PERMISSIONS[area].length, area).toBeGreaterThan(0)
    }
  })

  it('gives a member nothing — she is not staff, and this table is not her door', () => {
    for (const area of AREAS) {
      expect(canSee('member', area), area).toBe(false)
    }
  })
})
