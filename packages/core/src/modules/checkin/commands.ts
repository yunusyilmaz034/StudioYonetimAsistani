import type { BranchId, MemberId } from '../../shared'
import type { CheckInMethod } from './domain/types'

// The check-in command (Doc 3 §5). `checkIn.record` is offline-safe and idempotent —
// it allocates nothing — and is already whitelisted in the security rules. Applied by
// `on-command-created` as the receptionist (never the member, D2). A QR scan and a
// manual pick both write this command; `method` records which input was used (D7).

export const CHECKIN_RECORD = 'checkIn.record'
export type CheckInRecordType = typeof CHECKIN_RECORD

export interface CheckInRecordPayload {
  readonly memberId: MemberId
  readonly branchId: BranchId
  readonly method: CheckInMethod
}
