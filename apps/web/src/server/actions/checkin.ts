'use server'

import {
  closeBranch,
  FirestoreCheckinRepository,
  FirestoreEntitlementRepository,
  FirestoreReservationRepository,
  openBranch,
  systemClock,
  type BranchId,
  type CheckinDeps,
} from '@studio/core'
import { z } from 'zod'

import { requireTenantContext } from '../auth'
import { adminDb } from '../firebase-admin'

// Branch open/close is a daily operation — owner + receptionist + platform_admin.
// DESK (owner, 2026-08-03) — trainers now cover reception in practice ("bizim hocalar biraz da
// resepsiyona bakıyor"), so the reservation agenda and check-in are theirs too. They are not full
// reception: the members list, the till, the funnel and the reports stay closed. Every write here
// already records WHO did it, which is what makes widening it safe rather than merely convenient.
const OPS = ['owner', 'receptionist', 'trainer', 'platform_admin'] as const
const nonEmpty = z.string().min(1)

function deps(): CheckinDeps {
  return {
    repo: new FirestoreCheckinRepository(adminDb()),
    clock: systemClock,
    entries: new FirestoreEntitlementRepository(adminDb()),
    classes: new FirestoreReservationRepository(adminDb()),
  }
}

export async function openBranchAction(input: unknown) {
  const p = z.object({ branchId: nonEmpty }).parse(input)
  return openBranch(deps(), await requireTenantContext(OPS), { branchId: p.branchId as BranchId })
}

export async function closeBranchAction(input: unknown) {
  const p = z.object({ branchId: nonEmpty }).parse(input)
  return closeBranch(deps(), await requireTenantContext(OPS), { branchId: p.branchId as BranchId })
}
