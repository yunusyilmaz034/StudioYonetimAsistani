'use server'

import {
  clearMemberRestriction as clearMemberRestrictionUseCase,
  deactivateMember as deactivateMemberUseCase,
  FirestoreMemberRepository,
  registerMember,
  RestrictionReasons,
  setMemberRestriction as setMemberRestrictionUseCase,
  systemClock,
  updateMember as updateMemberUseCase,
  type BranchId,
  type DomainError,
  type MemberId,
  type MemberRestriction,
  type MembersDeps,
  type Result,
} from '@studio/core'
import { z } from 'zod'

import { requireTenantContext } from '../auth'
import { adminDb } from '../firebase-admin'

// zod at the boundary (Doc 6 §8). Members are written by owner + reception only,
// through a Server Action on the Admin SDK (AD-15, AD-35).
const contactSchema = z.object({
  name: z.string().min(1),
  phone: z.string().min(1),
})

const memberFields = {
  fullName: z.string().min(1),
  phone: z.string().min(1),
  homeBranchId: z.string().min(1).nullable(),
  email: z.string().min(1).nullable(),
  birthDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  notes: z.string().min(1).nullable(),
  emergencyContact: contactSchema.nullable(),
}

const createSchema = z.object(memberFields)
// `joinedAt` is editable on UPDATE only: a new member joins the day she is entered, and offering the
// field at registration is an invitation to mistype it. On update it fixes what the import guessed.
const updateSchema = z.object({
  memberId: z.string().min(1),
  ...memberFields,
  joinedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
})
const deactivateSchema = z.object({
  memberId: z.string().min(1),
  reason: z.string().min(1),
})

function deps(): MembersDeps {
  return { repo: new FirestoreMemberRepository(adminDb()), clock: systemClock }
}

const WRITERS = ['owner', 'receptionist'] as const
// A member override loosens or tightens the package rules for one person — a policy act, not a daily
// edit. Owner + platform_admin only (test: an unauthorized role may not change a member override).
const RESTRICTION_ROLES = ['owner', 'platform_admin'] as const

const restrictionSchema = z.object({
  memberId: z.string().min(1),
  reason: z.enum(RestrictionReasons),
  note: z.string().min(1),
  allowedWeekdays: z.array(z.number().int().min(0).max(6)).nullable(),
  allowedHourRanges: z
    .array(z.object({ startMinutes: z.number().int().min(0).max(1439), endMinutes: z.number().int().min(1).max(1440) }))
    .nullable(),
  // Tri-state: key ABSENT ⇒ inherit the package; null ⇒ unlimited; a number ⇒ that value.
  cancellationAllowance: z.number().int().min(0).nullable().optional(),
  dailyReservationLimit: z.number().int().min(1).nullable().optional(),
  activeReservationLimit: z.number().int().min(1).nullable().optional(),
  // Plus Phase 4 — trainer whitelist (null ⇒ any) and validity window (epoch ms; null ⇒ open-ended).
  allowedTrainerIds: z.array(z.string().min(1)).nullable(),
  effectiveFrom: z.number().int().nullable(),
  effectiveUntil: z.number().int().nullable(),
})

export async function setMemberRestrictionAction(input: unknown): Promise<Result<void, DomainError>> {
  const p = restrictionSchema.parse(input)
  const ctx = await requireTenantContext(RESTRICTION_ROLES)
  // Build the restriction OMITTING undefined keys — Firestore rejects `undefined`, and an absent key
  // is what "inherit" means. The domain refuses a malformed hour window / missing note.
  const restriction: MemberRestriction = {
    reason: p.reason,
    note: p.note,
    allowedWeekdays: p.allowedWeekdays,
    allowedHourRanges: p.allowedHourRanges,
    allowedTrainerIds: p.allowedTrainerIds,
    effectiveFrom: p.effectiveFrom,
    effectiveUntil: p.effectiveUntil,
    ...(p.cancellationAllowance !== undefined ? { cancellationAllowance: p.cancellationAllowance } : {}),
    ...(p.dailyReservationLimit !== undefined ? { dailyReservationLimit: p.dailyReservationLimit } : {}),
    ...(p.activeReservationLimit !== undefined ? { activeReservationLimit: p.activeReservationLimit } : {}),
  }
  return setMemberRestrictionUseCase(deps(), ctx, { memberId: p.memberId as MemberId, restriction })
}

export async function clearMemberRestrictionAction(input: unknown): Promise<Result<void, DomainError>> {
  const p = z.object({ memberId: z.string().min(1), reason: z.string().min(1) }).parse(input)
  const ctx = await requireTenantContext(RESTRICTION_ROLES)
  return clearMemberRestrictionUseCase(deps(), ctx, { memberId: p.memberId as MemberId, reason: p.reason })
}

export async function createMember(
  input: unknown,
): Promise<Result<{ memberId: MemberId }, DomainError>> {
  const parsed = createSchema.parse(input)
  const ctx = await requireTenantContext(WRITERS)
  return registerMember(deps(), ctx, {
    ...parsed,
    homeBranchId: parsed.homeBranchId as BranchId | null,
  })
}

export async function updateMember(input: unknown): Promise<Result<void, DomainError>> {
  const parsed = updateSchema.parse(input)
  const ctx = await requireTenantContext(WRITERS)
  // Midnight studio-local, so a date typed at the desk means that calendar day and not the previous
  // evening — the same offset arithmetic the rest of the system uses.
  const joinedAt = parsed.joinedAt ? Date.parse(`${parsed.joinedAt}T00:00:00Z`) - 180 * 60_000 : undefined
  // Built field by field rather than spread: with `exactOptionalPropertyTypes` an absent `joinedAt`
  // must be an ABSENT KEY, and a spread carries the key with an `undefined` value.
  return updateMemberUseCase(deps(), ctx, {
    memberId: parsed.memberId as MemberId,
    fullName: parsed.fullName,
    phone: parsed.phone,
    homeBranchId: parsed.homeBranchId as BranchId | null,
    email: parsed.email,
    birthDate: parsed.birthDate,
    notes: parsed.notes,
    emergencyContact: parsed.emergencyContact,
    ...(joinedAt !== undefined ? { joinedAt } : {}),
  })
}

export async function deactivateMember(input: unknown): Promise<Result<void, DomainError>> {
  const parsed = deactivateSchema.parse(input)
  const ctx = await requireTenantContext(WRITERS)
  return deactivateMemberUseCase(deps(), ctx, {
    memberId: parsed.memberId as MemberId,
    reason: parsed.reason,
  })
}
