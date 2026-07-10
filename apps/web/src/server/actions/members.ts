'use server'

import {
  deactivateMember as deactivateMemberUseCase,
  FirestoreMemberRepository,
  registerMember,
  systemClock,
  updateMember as updateMemberUseCase,
  type BranchId,
  type DomainError,
  type MemberId,
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
const updateSchema = z.object({ memberId: z.string().min(1), ...memberFields })
const deactivateSchema = z.object({
  memberId: z.string().min(1),
  reason: z.string().min(1),
})

function deps(): MembersDeps {
  return { repo: new FirestoreMemberRepository(adminDb()), clock: systemClock }
}

const WRITERS = ['owner', 'receptionist'] as const

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
  return updateMemberUseCase(deps(), ctx, {
    ...parsed,
    memberId: parsed.memberId as MemberId,
    homeBranchId: parsed.homeBranchId as BranchId | null,
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
