'use server'

import {
  closeBranch,
  FirestoreCheckinRepository,
  openBranch,
  systemClock,
  type BranchId,
  type CheckinDeps,
} from '@studio/core'
import { z } from 'zod'

import { requireTenantContext } from '../auth'
import { adminDb } from '../firebase-admin'

// Branch open/close is a daily operation — owner + receptionist + platform_admin.
const OPS = ['owner', 'receptionist', 'platform_admin'] as const
const nonEmpty = z.string().min(1)

function deps(): CheckinDeps {
  return { repo: new FirestoreCheckinRepository(adminDb()), clock: systemClock }
}

export async function openBranchAction(input: unknown) {
  const p = z.object({ branchId: nonEmpty }).parse(input)
  return openBranch(deps(), await requireTenantContext(OPS), { branchId: p.branchId as BranchId })
}

export async function closeBranchAction(input: unknown) {
  const p = z.object({ branchId: nonEmpty }).parse(input)
  return closeBranch(deps(), await requireTenantContext(OPS), { branchId: p.branchId as BranchId })
}
