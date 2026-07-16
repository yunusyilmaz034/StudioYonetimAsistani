'use server'

import { z } from 'zod'

import { requireMemberContext, requireTenantContext } from '../auth'
import {
  loadMemberFitness,
  loadOccupancyNow,
  loadStudioUsage,
  type MemberFitness,
  type OccupancyNow,
  type StudioUsage,
} from '../fitness-query'

// ── FITNESS ATTENDANCE & OCCUPANCY actions (Plus Phase 8). ──────────────────────────────────────
//
// A read-only surface: no action here writes state, emits an event, or moves a credit. Staff (OPS)
// see counts and names' worth of aggregates; a MEMBER sees only the anonymous occupancy LEVEL and her
// own consistency — never a headcount, never who is inside (§11 privacy).
const OPS = ['owner', 'receptionist', 'platform_admin'] as const

export async function occupancyNowAction(): Promise<OccupancyNow> {
  const ctx = await requireTenantContext(OPS)
  return loadOccupancyNow(ctx)
}

export async function studioUsageAction(): Promise<StudioUsage> {
  const ctx = await requireTenantContext(OPS)
  return loadStudioUsage(ctx, Date.now())
}

export async function memberFitnessAction(input: unknown): Promise<MemberFitness> {
  const p = z.object({ memberId: z.string().min(1) }).parse(input)
  const ctx = await requireTenantContext(OPS)
  return loadMemberFitness(ctx, p.memberId, Date.now())
}

// ── Member portal — anonymous only. ──────────────────────────────────────────────────────────
// The member is told how busy the studio is (a band), never how many people are inside or who.
export async function occupancyLevelForMemberAction(): Promise<{ level: OccupancyNow['level'] }> {
  const { ctx } = await requireMemberContext()
  const { level } = await loadOccupancyNow(ctx)
  return { level }
}

export async function myFitnessAction(): Promise<MemberFitness> {
  const { ctx, memberId } = await requireMemberContext()
  return loadMemberFitness(ctx, memberId, Date.now())
}
