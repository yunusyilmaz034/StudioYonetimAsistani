import {
  FirestoreMemberRepository,
  type MemberId,
  type ReservationOverride,
  type ReservationPolicyPort,
  type TenantContext,
} from '@studio/core'

import { adminDb } from './firebase-admin'

// Package Rules 2.0 (Plus Phase 3) — the reservations deps' member-override reader. A member's
// "Kısıtlı Üyelik" lives on her member document; the resolver reads it here, once per booking/cancel,
// to judge her against member → package → studio. Returns null for an ordinary member.
export function reservationPolicyPort(): ReservationPolicyPort {
  const repo = new FirestoreMemberRepository(adminDb())
  return {
    async getMemberOverride(ctx: TenantContext, memberId: MemberId): Promise<ReservationOverride | null> {
      const member = await repo.findById(ctx, memberId)
      return member?.restriction ?? null
    },
  }
}
