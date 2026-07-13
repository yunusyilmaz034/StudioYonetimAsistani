'use server'

import { createHash } from 'node:crypto'

import {
  eraseMember,
  ErasureReasons,
  FirestoreMemberRepository,
  FirestorePiiPurger,
  systemClock,
  type MemberId,
  type PurgePlan,
} from '@studio/core'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { requireTenantContext } from '../auth'
import { adminAuth, adminDb } from '../firebase-admin'
import { observed } from '../log'

// KVKK / GDPR erasure, from the product (v1.27 S5).
//
// ── Who may do this ─────────────────────────────────────────────────────────────────────────
// **`platform_admin` only — and the domain says so, not this file.** That is the founding owner (the
// one the bootstrap script created); an owner added later from the staff screen is deliberately NOT
// a platform admin. Erasure destroys information, and it is the one act in the system that should
// require the person who set the studio up.
//
// The guard here is the door; `decideErase` is the lock. If somebody removes this guard tomorrow,
// the domain still refuses.
//
// ── One implementation, two callers ─────────────────────────────────────────────────────────
// This action and `pnpm kvkk:erase` run the SAME code: `eraseMember()` for the aggregate,
// `FirestorePiiPurger` for the PII that leaked outward. Two implementations would be two behaviours,
// and the day they drift is the day one of them forgets her phone number.

const ADMIN = ['platform_admin'] as const

/** The uid the portal derives for her. An erasure that misses her LOGIN has not erased her. */
const memberUid = (studioId: string, memberId: string) =>
  `mbr_${createHash('sha256').update(`${studioId}:${memberId}`).digest('hex').slice(0, 24)}`

export interface ErasurePreview extends PurgePlan {
  readonly memberName: string
  readonly hasPortalAccount: boolean
  readonly alreadyErased: boolean
}

/** What would go. The owner sees this and *then* agrees — nothing is destroyed on a click. */
export async function previewErasureAction(input: unknown): Promise<ErasurePreview | null> {
  const p = z.object({ memberId: z.string().min(1) }).parse(input)
  const ctx = await requireTenantContext(ADMIN)

  const member = await new FirestoreMemberRepository(adminDb()).findById(ctx, p.memberId as MemberId)
  if (!member) return null

  const plan = await new FirestorePiiPurger(adminDb()).plan(ctx.studioId, p.memberId as MemberId)
  const hasPortalAccount = await adminAuth()
    .getUser(memberUid(ctx.studioId, p.memberId))
    .then(() => true)
    .catch(() => false)

  return {
    ...plan,
    memberName: member.fullName,
    hasPortalAccount,
    alreadyErased: Boolean(member.erased),
  }
}

export async function eraseMemberAction(input: unknown) {
  const p = z
    .object({
      memberId: z.string().min(1),
      reason: z.enum(ErasureReasons),
      // The human's explanation. It lives on the TOMBSTONE, never in the event: free text is the last
      // place PII can hide in a permanent log, and the log is forever.
      note: z.string().nullable().default(null),
    })
    .parse(input)
  const ctx = await requireTenantContext(ADMIN)

  // 1. The AGGREGATE — tombstone + `member.erased`, in one transaction (#1). Idempotent: a second
  //    erasure writes no second event.
  const res = await observed(
    'member.erase',
    ctx,
    undefined,
    { memberId: p.memberId, reason: p.reason },
    () =>
      eraseMember({ repo: new FirestoreMemberRepository(adminDb()), clock: systemClock }, ctx, {
        memberId: p.memberId as MemberId,
        reason: p.reason,
        note: p.note,
      }),
  )
  if (!res.ok) return res

  // 2. The PII that leaked outward — the same purger the break-glass script runs.
  await new FirestorePiiPurger(adminDb()).purge(ctx.studioId, p.memberId as MemberId)

  // 3. Her login. It is DELETED, not disabled: an account that can still be signed into is an
  //    identity that still exists.
  await adminAuth()
    .deleteUser(memberUid(ctx.studioId, p.memberId))
    .catch(() => undefined) // she never activated the portal

  revalidatePath(`/members/${p.memberId}`)
  revalidatePath('/members')
  return res
}
