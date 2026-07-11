import type { Firestore } from 'firebase-admin/firestore'

import {
  type ActorRef,
  type StaffRole,
  type StudioId,
  type SystemJobId,
  type TenantContext,
} from '@studio/core'

// A `system`-actor context for a studio-wide sweep (non-negotiable #5: the sweep is
// `system`, never a borrowed human). `role`/`branchIds` are inert here — a trusted
// background job bypasses the authz they guard, and the core repositories read only
// `studioId` to build tenant-scoped paths; the emitted events carry `actor: system`,
// never a role. `role: 'owner'` reads as "unrestricted studio scope".
export function systemTenantContext(studioId: StudioId, jobId: SystemJobId): TenantContext {
  return {
    studioId,
    branchIds: [],
    role: 'owner',
    actor: { type: 'system', id: jobId },
  }
}

// The `/commands` path applies a command AS the principal that wrote it (a trainer or
// receptionist marking the roster) — never `system`. `role` mirrors that principal
// where it is a staff role; it is inert for the resolve transaction regardless.
export function commandTenantContext(studioId: StudioId, actor: ActorRef): TenantContext {
  const role: StaffRole =
    actor.type === 'owner' || actor.type === 'receptionist' || actor.type === 'trainer'
      ? actor.type
      : 'receptionist'
  return { studioId, branchIds: [], role, actor }
}

// The studio set a sweep iterates. A root-collection read (NOT a collection-group
// query, which the architecture forbids) — the sweep is trusted server code.
export async function listStudioIds(database: Firestore): Promise<StudioId[]> {
  const snap = await database.collection('studios').get()
  return snap.docs.map((d) => d.id as StudioId)
}
