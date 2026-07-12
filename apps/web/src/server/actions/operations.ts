'use server'

import {
  applyBulk,
  applyClosure,
  FirestoreOperationsRepository,
  planBulk,
  planClosure,
  previewBulk,
  previewClosure,
  type BulkOperation,
  type BulkPlan,
  type ClosurePlan,
  type LocalDate,
  type OperationScope,
  type StudioClosure,
} from '@studio/core'
import { z } from 'zod'

import { requireTenantContext } from '../auth'
import { adminDb } from '../firebase-admin'
import { bulkDeps, closureDeps } from '../operations-query'

// D21 / D22 — the destructive operations.
//
// Owner-only, on purpose. These cancel classes, release credits and extend packages across the
// whole studio; reception can run the day, but this is the owner signing something.
const OWNER = ['owner', 'platform_admin'] as const

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

const scopeSchema: z.ZodType<OperationScope> = z.union([
  z.object({ kind: z.literal('studio') }),
  z.object({ kind: z.literal('category'), categories: z.array(z.enum(['pilates_group', 'fitness', 'private'])).min(1) }),
  z.object({ kind: z.literal('service'), serviceIds: z.array(z.string().min(1)).min(1) }),
  z.object({ kind: z.literal('product'), productIds: z.array(z.string().min(1)).min(1) }),
  z.object({ kind: z.literal('members'), memberIds: z.array(z.string().min(1)).min(1) }),
]) as z.ZodType<OperationScope>

// ── D21 ────────────────────────────────────────────────────────────────────────────────────

// PREVIEW — writes nothing. It is a pure plan over a fresh read; the owner looks at it and
// decides. Nothing in this call can cancel a class.
export async function previewClosureAction(input: unknown): Promise<ClosurePlan> {
  const p = z
    .object({
      dateFrom: date,
      dateTo: date,
      reason: z.string(),
      scope: scopeSchema,
      extensionDays: z.number().int().min(0).max(365),
    })
    .parse(input)
  const ctx = await requireTenantContext(OWNER)
  return previewClosure(closureDeps(), ctx, {
    dateFrom: p.dateFrom as LocalDate,
    dateTo: p.dateTo as LocalDate,
    reason: p.reason,
    scope: p.scope,
    extensionDays: p.extensionDays,
  })
}

export async function planClosureAction(input: unknown) {
  const p = z
    .object({
      dateFrom: date,
      dateTo: date,
      reason: z.string().min(1),
      scope: scopeSchema,
      extensionDays: z.number().int().min(0).max(365),
      calendarDayIds: z.array(z.string()).optional(),
    })
    .parse(input)
  const ctx = await requireTenantContext(OWNER)
  return planClosure(closureDeps(), ctx, {
    dateFrom: p.dateFrom as LocalDate,
    dateTo: p.dateTo as LocalDate,
    reason: p.reason,
    scope: p.scope,
    extensionDays: p.extensionDays,
    calendarDayIds: p.calendarDayIds ?? [],
  })
}

// APPLY — the irreversible one. Re-derives against the world as it is now, and I-28 refuses a
// second run.
export async function applyClosureAction(input: unknown) {
  const p = z.object({ closureId: z.string().min(1) }).parse(input)
  return applyClosure(closureDeps(), await requireTenantContext(OWNER), p.closureId)
}

export async function listClosuresAction(): Promise<readonly StudioClosure[]> {
  const ctx = await requireTenantContext(OWNER)
  return new FirestoreOperationsRepository(adminDb()).listClosures(ctx)
}

export async function getClosureAction(input: unknown): Promise<StudioClosure | null> {
  const p = z.object({ closureId: z.string().min(1) }).parse(input)
  const ctx = await requireTenantContext(OWNER)
  return new FirestoreOperationsRepository(adminDb()).getClosure(ctx, p.closureId)
}

// ── D22 ────────────────────────────────────────────────────────────────────────────────────

const actionSchema = z.union([
  z.object({ kind: z.literal('extend_days'), days: z.number().int().min(1).max(365) }),
  z.object({ kind: z.literal('add_credits'), credits: z.number().int().min(1).max(100) }),
])

export async function previewBulkAction(input: unknown): Promise<BulkPlan> {
  const p = z.object({ scope: scopeSchema }).parse(input)
  return previewBulk(bulkDeps(), await requireTenantContext(OWNER), { scope: p.scope })
}

export async function planBulkAction(input: unknown) {
  const p = z
    .object({
      action: actionSchema,
      scope: scopeSchema,
      // AD-39 — a credit movement carries a closed-enum reason AND a non-empty note. "Gerekçesiz
      // toplu işlem" is exactly the thing nobody can explain three months later.
      reason: z.enum(['gift', 'correction', 'migration', 'support']),
      note: z.string().min(1),
    })
    .parse(input)
  return planBulk(bulkDeps(), await requireTenantContext(OWNER), p)
}

export async function applyBulkAction(input: unknown) {
  const p = z.object({ bulkId: z.string().min(1) }).parse(input)
  return applyBulk(bulkDeps(), await requireTenantContext(OWNER), p.bulkId)
}

export async function listBulkAction(): Promise<readonly BulkOperation[]> {
  const ctx = await requireTenantContext(OWNER)
  return new FirestoreOperationsRepository(adminDb()).listBulk(ctx)
}
