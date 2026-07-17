import { describe, expect, it } from 'vitest'

import {
  claimsToTenantContext,
  effectiveRoles,
  isAuthorized,
  parseStaffClaims,
} from './claims'

const base: Record<string, unknown> = {
  studioId: 'std_1',
  role: 'owner',
  branchIds: ['brn_1'],
}

describe('parseStaffClaims', () => {
  it('accepts a valid owner claim, defaulting platformAdmin to false', () => {
    const c = parseStaffClaims('usr_1', base)
    expect(c?.studioId).toBe('std_1')
    expect(c?.role).toBe('owner')
    expect(c?.platformAdmin).toBe(false)
  })

  it('rejects missing studioId, invalid role, and a non-array branchIds', () => {
    expect(parseStaffClaims('usr_1', { ...base, studioId: undefined })).toBeNull()
    expect(parseStaffClaims('usr_1', { ...base, role: 'admin' })).toBeNull()
    expect(parseStaffClaims('usr_1', { ...base, branchIds: 'brn_1' })).toBeNull()
  })

  it('reads the platformAdmin flag', () => {
    expect(parseStaffClaims('usr_1', { ...base, platformAdmin: true })?.platformAdmin).toBe(
      true,
    )
  })
})

describe('claimsToTenantContext', () => {
  it('maps a studio role to the matching actor', () => {
    const c = parseStaffClaims('usr_1', base)
    expect(c).not.toBeNull()
    const ctx = claimsToTenantContext(c!)
    expect(ctx.actor).toEqual({ type: 'owner', id: 'usr_1' })
    expect(ctx.studioId).toBe('std_1')
    expect(ctx.branchIds).toEqual(['brn_1'])
  })

  it('attributes a platform_admin action to a platform_admin actor', () => {
    const c = parseStaffClaims('usr_1', { ...base, platformAdmin: true })
    expect(claimsToTenantContext(c!).actor).toEqual({ type: 'platform_admin', id: 'usr_1' })
  })

  it('attributes the kiosk to a DEVICE, not a human (non-negotiable #5)', () => {
    // The wall tablet is a thing, not a person. A check-in it records must never carry a human's
    // identity — it is the tablet, a `device`, and its uid names WHICH tablet.
    const c = parseStaffClaims('usr_kiosk', { ...base, role: 'kiosk' })
    expect(c?.role).toBe('kiosk')
    expect(claimsToTenantContext(c!).actor).toEqual({ type: 'device', id: 'usr_kiosk' })
  })
})

describe('isAuthorized — the catalogue guard (AD-46)', () => {
  const owner = parseStaffClaims('usr_o', base)!
  const reception = parseStaffClaims('usr_r', { ...base, role: 'receptionist' })!
  const admin = parseStaffClaims('usr_a', { ...base, platformAdmin: true })!
  const allowed = ['owner', 'platform_admin'] as const

  it('lets owner and platform_admin write the catalogue; refuses reception', () => {
    expect(isAuthorized(owner, allowed)).toBe(true)
    expect(isAuthorized(admin, allowed)).toBe(true)
    expect(isAuthorized(reception, allowed)).toBe(false)
  })

  it('adds platform_admin to the effective roles only when flagged', () => {
    expect(effectiveRoles(reception)).toEqual(['receptionist'])
    expect(effectiveRoles(admin)).toEqual(['owner', 'platform_admin'])
  })
})
