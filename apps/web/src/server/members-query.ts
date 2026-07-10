import { FirestoreMemberRepository, type Member, type TenantContext } from '@studio/core'

import { adminDb } from './firebase-admin'

// Server-only member reads. Lives in server/ (the trusted boundary) so app/ server
// components stay thin and never touch the Admin SDK directly.
export async function listMembers(ctx: TenantContext): Promise<Member[]> {
  const repo = new FirestoreMemberRepository(adminDb())
  return [...(await repo.list(ctx))]
}
