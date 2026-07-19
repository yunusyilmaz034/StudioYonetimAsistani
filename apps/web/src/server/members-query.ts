import {
  available,
  debtByMember,
  FirestoreFinanceRepository,
  systemClock,
  FirestoreEntitlementRepository,
  FirestoreMemberRepository,
  type Member,
  type TenantContext,
} from '@studio/core'

import { badgesFor, type MemberBadges, type MemberFacts } from '@/lib/members/filters'

import { adminDb } from './firebase-admin'

// Server-only member reads. Lives in server/ (the trusted boundary) so app/ server
// components stay thin and never touch the Admin SDK directly.
export async function listMembers(ctx: TenantContext): Promise<Member[]> {
  const repo = new FirestoreMemberRepository(adminDb())
  return [...(await repo.list(ctx))]
}

export interface MemberRow {
  readonly id: string
  readonly fullName: string
  readonly phone: string
  readonly phoneNormalized: string
  readonly status: string
  readonly joinedAt: number // for the "son eklenen" sort (PF-33)
  readonly badges: MemberBadges
}

/**
 * The members list, with the facts the filters need (v1.27 S7).
 *
 * TWO reads for the whole screen — the members and the entitlements — and the classification is done
 * in memory. A per-member query would be forty-five round trips to answer a question the studio asks
 * every morning; the studio is small, and the honest way to serve a small studio is to read its data
 * once.
 *
 * The badge is computed on the SERVER: the client has no business holding the credit ledger. A row
 * carries what the list must show, and nothing more.
 */
export async function listMemberRows(ctx: TenantContext, nowMs: number): Promise<MemberRow[]> {
  const db = adminDb()
  // THREE reads. The debt comes from the LEDGER's open sales — `member.stats.balanceDue` is a
  // denormalised field that **nothing has ever written**: it was zero for every member, so the
  // "Borçlu" filter matched nobody and the membership report's Bakiye column was a column of zeros
  // (Alpha Review, 2026-07-13).
  const [members, entitlements, debt] = await Promise.all([
    new FirestoreMemberRepository(db).list(ctx),
    new FirestoreEntitlementRepository(db).listAll(ctx),
    debtByMember({ repo: new FirestoreFinanceRepository(db), clock: systemClock }, ctx),
  ])

  const byMember = new Map<string, MemberFacts['packages'][number][]>()
  for (const e of entitlements) {
    const list = byMember.get(e.memberId as string) ?? []
    list.push({
      status: e.status,
      validUntil: e.validUntil,
      // `null` ⇔ a period package: it grants time, not a number of classes, and it has no number to
      // run out of.
      creditsAvailable: e.credits ? (e.status === 'active' ? available(e.credits) : 0) : null,
    })
    byMember.set(e.memberId as string, list)
  }

  return members.map((m) => ({
    id: m.id as string,
    fullName: m.fullName,
    phone: m.phone as string,
    phoneNormalized: m.phoneNormalized,
    status: m.status,
    joinedAt: m.joinedAt as number,
    badges: badgesFor(
      {
        status: m.status,
        balanceDueKurus: debt.get(m.id as string)?.amount ?? 0,
        packages: byMember.get(m.id as string) ?? [],
      },
      nowMs,
    ),
  }))
}
