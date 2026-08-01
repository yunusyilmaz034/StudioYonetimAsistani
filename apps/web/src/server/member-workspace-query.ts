import {
  FirestoreCatalogRepository,
  FirestoreCheckinRepository,
  FirestoreEntitlementRepository,
  FirestoreFinanceRepository,
  FirestoreMemberRepository,
  FirestoreReservationRepository,
  instant,
  moneyByEntitlement,
  systemClock,
  type Member,
  type MemberEventRecord,
  type MemberId,
  type TenantContext,
} from '@studio/core'

import { memberStateOf, type MemberState } from '@/lib/members/filters'
import { adminDb } from './firebase-admin'

// The Member Workspace read (v1.18). Direct bounded parallel reads — no projection,
// no aggregate (D2). Composes five existing/added read-only core reads by memberId.
// The Packages and Payments sections load subscriptions client-side via the existing
// listMemberSubscriptionsAction (SubscriptionView already carries balance/collected),
// so entitlements are not read here.
//
// Bounds are config, not scattered literals (D3) — one place to change them. These are
// read/display limits, NOT credit-affecting policy (non-negotiable #4 does not apply).
export const MEMBER_WORKSPACE_LIMITS = {
  checkInHistoryDays: 90, // §3.4
  pastReservations: 50, // §3.3
  auditEvents: 100, // §3.6
} as const

const DAY_MS = 86_400_000

export interface MemberReservationRow {
  readonly reservationId: string
  readonly status: string
  readonly category: string
  readonly startsAt: number
  readonly endsAt: number
  readonly creditEffect: string
  // WHICH PACKAGE PAID FOR THIS (owner, 2026-07-28). Their previous system colours a member's
  // reservations by subscription so a glance tells you which package each one came out of — and its
  // own help text admits the grouping "may be wrong for overlapping subscriptions", because it
  // INFERS the link from dates. We do not have to infer it: the reservation has held a credit from a
  // named entitlement since it was booked. Exact, not guessed.
  readonly entitlementId: string
  readonly packageName: string | null
  /** Stable per package within this member's list — the UI turns it into a colour. */
  readonly packageIndex: number
}

export interface MemberCheckInRow {
  readonly id: string
  readonly direction: 'in' | 'out'
  readonly method: string
  readonly occurredAt: number
}

export interface MemberWorkspaceData {
  readonly member: Member
  // The count of currently-active packages, computed LIVE from the entitlements (status === 'active') —
  // NOT from `member.stats.activeEntitlementCount`, which no reactor maintains (it is permanently 0).
  // Matches the "Aktif paketi olan" members-list filter so the header and the list never disagree.
  readonly activePackageCount: number
  /**
   * Aktif · Duraklatılmış · Pasif (owner, 2026-08-01) — the same derivation the members list runs,
   * from the same shared function, so her card and her row cannot disagree about who she is.
   *
   * Note this is NOT `activePackageCount > 0`: that count is of `status === 'active'` entitlements
   * and a FROZEN package is deliberately excluded from it (the header says how many she can book
   * with today). A frozen member is still active — she has bought and she is coming back.
   */
  readonly state: MemberState
  // The member's outstanding balance in kuruş, read LIVE from the LEDGER (moneyByEntitlement) — the same
  // source the Paketler/Cari Hesap tabs use — NOT from `member.stats.balanceDue`, which is also an
  // unmaintained (permanently 0) field. A debt must never read as 0 in the header while the tab shows it.
  readonly balanceDueKurus: number
  readonly upcomingReservations: readonly MemberReservationRow[]
  readonly pastReservations: readonly MemberReservationRow[]
  readonly insideNow: boolean
  readonly lastCheckInAt: number | null
  readonly checkInHistory: readonly MemberCheckInRow[]
  readonly audit: readonly MemberEventRecord[]
}

export async function loadMemberWorkspace(
  ctx: TenantContext,
  memberId: string,
  nowMs: number,
): Promise<MemberWorkspaceData | null> {
  const db = adminDb()
  const id = memberId as MemberId
  const since = instant(nowMs - MEMBER_WORKSPACE_LIMITS.checkInHistoryDays * DAY_MS)

  const members = new FirestoreMemberRepository(db)
  const reservations = new FirestoreReservationRepository(db)
  const checkin = new FirestoreCheckinRepository(db)
  const entitlements = new FirestoreEntitlementRepository(db)

  const [member, memberReservations, presence, checkIns, audit, activeEntitlements, money, products] = await Promise.all([
    members.findById(ctx, id),
    reservations.listByMember(ctx, id),
    checkin.getPresence(ctx, id),
    checkin.listCheckInsByMember(ctx, id, since),
    members.listMemberEvents(ctx, id, MEMBER_WORKSPACE_LIMITS.auditEvents),
    entitlements.listActiveByMember(ctx, id),
    moneyByEntitlement({ repo: new FirestoreFinanceRepository(db), clock: systemClock }, ctx, id),
    new FirestoreCatalogRepository(db).listProducts(ctx),
  ])

  if (!member) return null

  // A HYBRID is ONE package the member holds, even though the domain stores it as one entitlement per
  // component (the category wall). Count a bundle ONCE — by productId — so the header agrees with the
  // single card the Paketler tab now shows; non-bundle packages each count on their own.
  const bundleProductIds = new Set(products.filter((p) => (p.components?.length ?? 0) > 0).map((p) => p.id as string))
  const seenBundles = new Set<string>()
  let activePackageCount = 0
  for (const e of activeEntitlements) {
    const pid = e.productSnapshot.productId as string
    if (bundleProductIds.has(pid)) {
      if (seenBundles.has(pid)) continue
      seenBundles.add(pid)
    }
    activePackageCount++
  }

  // Sum the outstanding across every package this member bought (the ledger's `due`), so the header
  // balance matches the Cari Hesap tab to the kuruş.
  let balanceDueKurus = 0
  for (const m of money.values()) balanceDueKurus += m.due.amount

  // Every package this member has EVER held, named — not only the active ones: a past reservation
  // was paid for by a package that may have expired months ago, and colouring it "unknown" would
  // lose exactly the history the owner wants to see.
  const allEnts = await entitlements.listByMember(ctx, id).catch(() => activeEntitlements)
  const packageNameById = new Map<string, string>()
  for (const e of allEnts) packageNameById.set(e.id as string, e.productSnapshot.name)

  // A stable index per entitlement, ordered by when the package started, so the colours read like a
  // timeline: her first package is the first colour, whichever reservation you happen to look at.
  const orderedEntIds = [...allEnts]
    .sort((a, b) => a.validFrom - b.validFrom || (a.id < b.id ? -1 : 1))
    .map((e) => e.id as string)
  const packageIndexById = new Map(orderedEntIds.map((eid, i) => [eid, i]))

  const toRow = (r: (typeof memberReservations)[number]): MemberReservationRow => ({
    reservationId: r.id,
    status: r.status,
    category: r.sessionCategory,
    startsAt: r.sessionStartsAt,
    endsAt: r.sessionEndsAt,
    creditEffect: r.creditEffect,
    entitlementId: r.entitlementId as string,
    packageName: packageNameById.get(r.entitlementId as string) ?? null,
    packageIndex: packageIndexById.get(r.entitlementId as string) ?? 0,
  })

  // listByMember is newest-session-first. Upcoming re-sorted ascending (soonest next);
  // past kept descending and capped.
  const upcoming = memberReservations
    .filter((r) => r.sessionStartsAt >= nowMs)
    .map(toRow)
    .sort((a, b) => a.startsAt - b.startsAt)
  const past = memberReservations
    .filter((r) => r.sessionStartsAt < nowMs)
    .slice(0, MEMBER_WORKSPACE_LIMITS.pastReservations)
    .map(toRow)

  const history: MemberCheckInRow[] = checkIns.map((c) => ({
    id: c.id,
    direction: c.direction,
    method: c.method,
    occurredAt: c.occurredAt,
  }))

  // Her state, from every package she has ever held — `activeEntitlements` cannot answer it because
  // the repository filters on `status === 'active'` and a frozen package is not that. The predicate
  // is the list's: frozen counts, and an `active` row whose date has passed does not (the nightly
  // sweep may not have flipped it yet).
  const liveCount = allEnts.filter(
    (e) => e.status === 'frozen' || (e.status === 'active' && (e.validUntil as number) >= nowMs),
  ).length

  return {
    member,
    state: memberStateOf(member.status, liveCount),
    activePackageCount,
    balanceDueKurus,
    upcomingReservations: upcoming,
    pastReservations: past,
    insideNow: presence !== null,
    lastCheckInAt: presence?.checkedInAt ?? history[0]?.occurredAt ?? null,
    checkInHistory: history,
    audit,
  }
}
