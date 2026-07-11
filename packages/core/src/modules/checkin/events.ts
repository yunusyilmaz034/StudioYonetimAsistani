import type { BranchId } from '../../shared'
import type { CheckInMethod } from './domain/types'

// Check-in / occupancy events (Doc 4 §"Check-in"). The producer never appears in the
// type (AD-18): a reception tap, a QR scan, and a 2027 turnstile all emit
// `member.checked_in` — `method` is metadata, `actor` is who is responsible. No PII
// (I-13). All five types already exist in the Doc 4 catalogue; v1.15 produces them.

export const MEMBER_CHECKED_IN = 'member.checked_in'
export const MEMBER_CHECKED_OUT = 'member.checked_out'
export const MEMBER_AUTO_CHECKED_OUT = 'member.auto_checked_out'
export const BRANCH_OPENED = 'branch.opened'
export const BRANCH_CLOSED = 'branch.closed'

export type MemberCheckedInPayload = {
  readonly branchId: BranchId
  readonly method: CheckInMethod
  readonly occupancyAfter: number
}
export type MemberCheckedOutPayload = {
  readonly branchId: BranchId
  readonly method: CheckInMethod
  readonly durationMinutes: number
  readonly occupancyAfter: number
}
export type MemberAutoCheckedOutPayload = {
  readonly branchId: BranchId
  readonly thresholdHours: number
}
export type BranchOpenedPayload = {
  readonly scheduledOpenAt: number
}
export type BranchClosedPayload = {
  readonly occupancyAtClose: number
}
