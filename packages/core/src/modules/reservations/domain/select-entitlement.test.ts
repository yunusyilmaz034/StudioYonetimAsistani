import { describe, expect, it } from 'vitest'

import type { Entitlement, Grant } from '../../entitlements'
import type { ClassSession } from '../../scheduling'
import {
  instant,
  money,
  type BranchId,
  type ClassSessionId,
  type EntitlementId,
  type Instant,
  type MemberId,
  type ProductId,
  type RoomId,
  type ServiceId,
  type StudioId,
} from '../../../shared'
import { selectEntitlement } from './select-entitlement'

const NOW = instant(1_000_000_000_000)
const D = 86_400_000

const sess = (): ClassSession => ({
  id: 'cls_1' as ClassSessionId,
  studioId: 'std_1' as StudioId,
  branchId: 'brn_1' as BranchId,
  serviceId: 'svc_1' as ServiceId,
  roomId: 'rom_1' as RoomId,
  trainerId: null,
  templateId: null,
  assignedMemberId: null,
  category: 'pilates_group',
  startsAt: instant(NOW + 2 * D),
  endsAt: instant(NOW + 2 * D + 3_600_000),
  capacity: 8,
  status: 'scheduled',
  cancellation: null,
  policyRef: { serviceId: 'svc_1' as ServiceId, version: 1 },
  policySnapshot: {
    maxDaysInAdvance: 14,
    cancellationWindowHours: 6,
    cancellationWindowSource: 'service' as const,
    lateCancellationConsumesCredit: true,
    noShowConsumesCredit: false,
    attendanceDefaultOutcome: 'attended',
    autoResolveAfterMinutes: 15,
    allowMemberSelfBooking: false,
  },
  bookedCount: 0,
  attendedCount: 0,
  serviceName: 'Reformer',
  roomName: 'A',
  trainerName: null,
  branchName: 'Merkez',
})

let seq = 0
function ent(opts: {
  id: string
  validUntil: Instant
  grant?: Grant
  category?: 'pilates_group' | 'fitness'
  status?: Entitlement['status']
  available?: number
  purchasedAt?: Instant
  serviceIds?: readonly ServiceId[] // D12 — omitted ⇒ a legacy (pre-D12) purchase
}): Entitlement {
  const grant: Grant = opts.grant ?? { kind: 'credits', credits: 8, validForDays: 30 }
  const avail = opts.available ?? 8
  seq += 1
  return {
    id: opts.id as EntitlementId,
    studioId: 'std_1' as StudioId,
    memberId: 'mem_1' as MemberId,
    productId: 'prd_1' as ProductId,
    productSnapshot: {
      productId: 'prd_1' as ProductId,
      name: 'P',
      category: opts.category ?? 'pilates_group',
      grant,
      listPrice: money(1),
      ...(opts.serviceIds ? { serviceIds: opts.serviceIds } : {}),
    },
    policyRef: { policyId: 'pol_1', version: 1 },
    status: opts.status ?? 'active',
    validFrom: instant(NOW - D),
    validUntil: opts.validUntil,
    credits: grant.kind === 'credits' ? { granted: avail, held: 0, consumed: 0, restored: 0, revoked: 0, expired: 0 } : null,
    freeze: null,
    priceAgreed: money(1),
    paidTotal: money(0),
    manualPayment: null,
    purchasedAt: opts.purchasedAt ?? instant(NOW - seq * D),
  }
}

describe('selectEntitlement (I-17)', () => {
  it('chooses the earliest-expiring bookable entitlement', () => {
    const soon = ent({ id: 'ent_soon', validUntil: instant(NOW + 10 * D) })
    const later = ent({ id: 'ent_later', validUntil: instant(NOW + 40 * D) })
    expect(selectEntitlement([later, soon], sess(), NOW)?.id).toBe('ent_soon')
  })
  it('spends credits before an unlimited period package (no scarcity)', () => {
    const period = ent({ id: 'ent_period', validUntil: instant(NOW + 5 * D), grant: { kind: 'period', durationDays: 90, access: 'unlimited' } })
    const credit = ent({ id: 'ent_credit', validUntil: instant(NOW + 40 * D) })
    expect(selectEntitlement([period, credit], sess(), NOW)?.id).toBe('ent_credit')
  })
  it('filters out the wrong category, the expired-before-session, the empty, and the frozen', () => {
    const wrongCat = ent({ id: 'e_cat', validUntil: instant(NOW + 40 * D), category: 'fitness' })
    const expiresFirst = ent({ id: 'e_exp', validUntil: instant(NOW + D) }) // < session startsAt (2d)
    const empty = ent({ id: 'e_empty', validUntil: instant(NOW + 40 * D), available: 0 })
    const frozen = ent({ id: 'e_frozen', validUntil: instant(NOW + 40 * D), status: 'frozen' })
    const good = ent({ id: 'e_good', validUntil: instant(NOW + 50 * D) })
    expect(selectEntitlement([wrongCat, expiresFirst, empty, frozen, good], sess(), NOW)?.id).toBe('e_good')
  })
  it('returns null when nothing is bookable', () => {
    const empty = ent({ id: 'e_empty', validUntil: instant(NOW + 40 * D), available: 0 })
    expect(selectEntitlement([empty], sess(), NOW)).toBeNull()
  })

  // ── D12 — the advisory path must answer exactly as decideBooking does, or the UI offers a
  //    booking the domain then refuses.
  it('skips a package that does not cover the session’s service, and picks one that does', () => {
    const wrongService = ent({ id: 'e_wrong', validUntil: instant(NOW + 10 * D), serviceIds: ['svc_9' as ServiceId] })
    const covers = ent({ id: 'e_covers', validUntil: instant(NOW + 40 * D), serviceIds: ['svc_1' as ServiceId] })
    expect(selectEntitlement([wrongService, covers], sess(), NOW)?.id).toBe('e_covers')
  })

  it('a legacy package (no service list) is still selectable — category-wide, as sold', () => {
    const legacy = ent({ id: 'e_legacy', validUntil: instant(NOW + 40 * D) })
    expect(selectEntitlement([legacy], sess(), NOW)?.id).toBe('e_legacy')
  })

  it('returns null when the only package covers a different service', () => {
    const wrongService = ent({ id: 'e_wrong', validUntil: instant(NOW + 40 * D), serviceIds: ['svc_9' as ServiceId] })
    expect(selectEntitlement([wrongService], sess(), NOW)).toBeNull()
  })
})
