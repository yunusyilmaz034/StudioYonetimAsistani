'use server'

import {
  changeStaffRole,
  createStaff,
  deactivateStaff,
  FirestoreIdentityRepository,
  reactivateStaff,
  systemClock,
  type IdentityDeps,
  type StaffRole,
  type StaffUserId,
} from '@studio/core'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { requireTenantContext } from '../auth'
import { adminAuth, adminDb } from '../firebase-admin'
import { observed } from '../log'

// Who may work here, and as what (v1.27 S1 · owner, 2026-07-13).
//
// **Owner only, and the domain says so too.** The guard here decides who may knock; `decideCreateStaff`
// decides who may enter, by checking `actor.type`. Two locks on the same door, because this is the
// door that opens all the others: granting the receptionist role hands somebody every member's phone
// number and the key to the till, and it looks like an administrative chore while it does it.

const OWNER = ['owner', 'platform_admin'] as const
const deps = (): IdentityDeps => ({
  repo: new FirestoreIdentityRepository(adminDb()),
  clock: systemClock,
})

const ROLES = ['owner', 'receptionist', 'trainer'] as const

export interface StaffRow {
  readonly id: string
  readonly displayName: string
  readonly role: StaffRole
  readonly active: boolean
  readonly isSelf: boolean
  /** The domain refuses to touch her (a studio always has at least one active owner). The screen
   *  disables the controls so the owner never meets that refusal as a surprise — but the refusal is
   *  what actually holds, and it holds against a request the screen never sent. */
  readonly isLastOwner: boolean
}

export async function listStaffAction(): Promise<readonly StaffRow[]> {
  const ctx = await requireTenantContext(OWNER)
  const rows = await deps().repo.listStaff(ctx)
  const activeOwners = rows.filter((s) => s.active && s.role === 'owner').length

  return rows
    .map((s) => ({
      ...s,
      isSelf: s.id === (ctx.actor.id as string),
      isLastOwner: s.role === 'owner' && s.active && activeOwners <= 1,
    }))
    .sort((a, b) => Number(b.active) - Number(a.active) || a.displayName.localeCompare(b.displayName, 'tr'))
}

/**
 * Create a colleague: an Auth account, a record, an event, and — last — the claims that make the
 * account mean anything.
 *
 * The ORDER is the whole design. Claims come last, so a failure halfway leaves her with a record and
 * no access (visible, harmless, fixed by re-running) rather than full access with no record of how
 * she got it.
 */
export async function createStaffAction(input: unknown) {
  const p = z
    .object({
      email: z.string().email(),
      displayName: z.string().min(1),
      role: z.enum(ROLES),
      password: z.string().min(8, 'Şifre en az 8 karakter olmalı'),
    })
    .parse(input)
  const ctx = await requireTenantContext(OWNER)

  // 1. The account, with NO claims. It can sign in and reach nothing: with no `studioId` claim,
  //    every guard in the product treats her as a stranger.
  const existing = await adminAuth().getUserByEmail(p.email).catch(() => null)
  const user =
    existing ??
    (await adminAuth().createUser({
      email: p.email,
      password: p.password,
      displayName: p.displayName,
    }))

  // 2. The record and `staff.created`, in one transaction (#1).
  const res = await observed(
    'staff.create',
    ctx,
    undefined,
    { staffUserId: user.uid, role: p.role },
    () =>
      createStaff(deps(), ctx, {
        staff: {
          id: user.uid as StaffUserId,
          displayName: p.displayName, // PII — it lives on /staff, never in the event (#6)
          role: p.role,
          active: true,
        },
      }),
  )
  if (!res.ok) return res

  // 3. Only now does the account become somebody.
  await adminAuth().setCustomUserClaims(user.uid, {
    studioId: ctx.studioId,
    role: p.role,
    branchIds: ctx.branchIds,
    platformAdmin: false, // never granted from a screen. The platform admin is a break-glass identity.
  })

  revalidatePath('/staff')
  return res
}

export async function changeStaffRoleAction(input: unknown) {
  const p = z.object({ staffUserId: z.string().min(1), role: z.enum(ROLES) }).parse(input)
  const ctx = await requireTenantContext(OWNER)

  const res = await observed(
    'staff.change_role',
    ctx,
    undefined,
    { staffUserId: p.staffUserId, role: p.role },
    () => changeStaffRole(deps(), ctx, { staffUserId: p.staffUserId as StaffUserId, role: p.role }),
  )
  if (!res.ok) return res

  // The claim is the thing that actually grants the access; the record is what explains it. They are
  // written in that order for the same reason as above — and re-running fixes a half-applied change.
  const current = (await adminAuth().getUser(p.staffUserId)).customClaims ?? {}
  await adminAuth().setCustomUserClaims(p.staffUserId, { ...current, role: p.role })

  revalidatePath('/staff')
  return res
}

export async function deactivateStaffAction(input: unknown) {
  const p = z.object({ staffUserId: z.string().min(1), reason: z.string().min(1) }).parse(input)
  const ctx = await requireTenantContext(OWNER)

  const res = await observed(
    'staff.deactivate',
    ctx,
    undefined,
    { staffUserId: p.staffUserId },
    () =>
      deactivateStaff(deps(), ctx, { staffUserId: p.staffUserId as StaffUserId, reason: p.reason }),
  )
  if (!res.ok) return res

  // Her account is DISABLED, not deleted. Deleting it would orphan every event she ever caused —
  // the log points at her uid — and an audit that cannot name the actor is not an audit.
  await adminAuth().updateUser(p.staffUserId, { disabled: true })

  revalidatePath('/staff')
  return res
}

export async function reactivateStaffAction(input: unknown) {
  const p = z.object({ staffUserId: z.string().min(1) }).parse(input)
  const ctx = await requireTenantContext(OWNER)

  const res = await observed('staff.reactivate', ctx, undefined, { staffUserId: p.staffUserId }, () =>
    reactivateStaff(deps(), ctx, { staffUserId: p.staffUserId as StaffUserId }),
  )
  if (!res.ok) return res

  await adminAuth().updateUser(p.staffUserId, { disabled: false })
  revalidatePath('/staff')
  return res
}
