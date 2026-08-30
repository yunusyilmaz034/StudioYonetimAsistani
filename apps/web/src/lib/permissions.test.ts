import { describe, expect, it } from 'vitest'

import { canSee, homeFor, PERMISSIONS, type Area } from './permissions'

// The permission matrix, asserted — because until v1.27 there was no matrix, and every staff page
// asked "are you staff?" while none asked "which role?". A trainer could open the members list, the
// till and the sales funnel. The write actions would have refused her; she could already SEE the
// studio's PII and its money, and reads are what a leak is made of.

const AREAS = Object.keys(PERMISSIONS) as Area[]

describe('the trainer — staff, and the person least entitled to the studio’s data', () => {
  it('sees her own screens, plus the two the desk shares with her', () => {
    // Her classes, the training workspace (the exercise library and her feedback center), her OWN
    // earnings (read-only, never another trainer's), and the Bilgi Merkezi every staff role reads.
    //
    // Since 2026-08-03 also the RESERVATION AGENDA and CHECK-IN: the studio's trainers cover the desk
    // in practice ("bizim hocalar biraz da resepsiyona bakıyor"). Two screens, not a promotion —
    // everything that reveals the business or the studio's PII at large stays shut, which is what
    // the next four cases hold in place.
    // Since 2026-08-30 also `/trainees` — the trainers are being brought into the system, and the
    // work they are here to do needs a member screen. It is a SECOND screen over the same members,
    // not the members list with rows hidden: the case below holds that distinction in place.
    const visible = AREAS.filter((a) => canSee('trainer', a))
    expect(visible).toEqual([
      '/reservations',
      '/checkin',
      '/knowledge',
      '/my-classes',
      '/trainees',
      '/training',
      '/my-payroll',
    ])
  })

  it('reaches members through her OWN screen, never through reception’s', () => {
    // `/members` carries the phone in its header and Cari Hesap, Cüzdan, Belgeler and the package
    // history in its tabs. Opening it to her would hand her everything the owner said she must not
    // have, which is why the answer was a second screen rather than a wider row here.
    expect(canSee('trainer', '/trainees')).toBe(true)
    expect(canSee('trainer', '/members')).toBe(false)
  })

  it('the desk does NOT get the trainer’s member screen — it would be a worse /members', () => {
    // Reception already has the real one. A second, thinner members list in her rail is two doors to
    // the same room and one more place for the two to drift apart.
    expect(canSee('receptionist', '/trainees')).toBe(false)
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
  // `/trainees` joins them for the same reason: the owner has the richer `/members`, and putting a
  // second "Üyeler" in her rail would be two doors to the same room.
  const TRAINER_PERSONAL = ['/my-classes', '/my-payroll', '/trainees'] as const
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
