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
    expect(visible).toEqual(['/my-classes', '/training', '/my-payroll'])
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

describe('reception — she runs the day, and she does not run the business', () => {
  it('has the desk: members, packages, the calendar, the till, check-in, fitness', () => {
    for (const area of ['/', '/members', '/packages', '/schedule', '/checkin', '/fitness', '/finance'] as const) {
      expect(canSee('receptionist', area), area).toBe(true)
    }
  })

  it('a trainer does not get the fitness usage screen — it is the studio’s data, not her craft', () => {
    expect(canSee('trainer', '/fitness')).toBe(false)
  })

  it('is refused the audit log, the analytics, the settings, the staff list, and payroll (owner, 2026-07-13)', () => {
    for (const area of ['/audit', '/analytics', '/settings', '/staff', '/payroll', '/my-payroll'] as const) {
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
  it('sees everything — there is no screen she is kept out of', () => {
    for (const area of AREAS) {
      expect(canSee('owner', area), area).toBe(true)
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
