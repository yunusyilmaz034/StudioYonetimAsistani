import { available, FirestoreEntitlementRepository, FirestoreMemberRepository, type TenantContext } from '@studio/core'

import { maskName } from '@/lib/demo-mask'

import { isDemoMode } from './demo-mode'
import { adminDb } from './firebase-admin'

// THE TRAINER'S VIEW OF A MEMBER (owner, 2026-08-30).
//
// The trainers are being brought into the system. To write a programme, record a measurement and plan
// around what is left of a package, a trainer needs a member screen — and `/members` cannot be it: its
// header carries the phone, its tabs carry Cari Hesap, Cüzdan, Belgeler and the full package history.
//
// So the boundary is drawn HERE, in the query, not in the screen. A field the trainer may not see is
// never read into the shape she is served, which means it never crosses to her browser and cannot be
// recovered from the page source, the network tab, or a React devtools panel. Hiding a phone number in
// CSS is not hiding a phone number.
//
// WHAT IS DELIBERATELY ABSENT, and would be a defect to add:
//   · phone / phoneNormalized — the studio's PII, and the single field that makes a member list worth
//     copying. The owner's rule is explicit: "üyenin telefon ... göremesin".
//   · balanceDue, priceAgreed, any payment — the trainer is not on the money path at all.
//   · the package HISTORY — only what is active today, because that is all a lesson is planned
//     against. What she used to buy is the business's record, not the trainer's tool.
//
// TWO reads for the whole screen (members + entitlements), classified in memory — the same shape the
// members list uses. A per-member query would be one round trip per woman to answer a question the
// studio asks every morning.

export interface TraineePackage {
  readonly name: string
  readonly category: string
  readonly validUntil: number
  /** `null` ⇔ a period package: it grants time, not a number of classes, so it has nothing to run out of. */
  readonly creditsAvailable: number | null
  readonly remainingDays: number
}

export interface TraineeRow {
  readonly id: string
  readonly fullName: string
  /** Every package that is ACTIVE right now — a hybrid member legitimately has more than one. */
  readonly packages: readonly TraineePackage[]
}

/** Bir üyenin aktif paketleri, en geç bitenden en erken bitene. */
function paketleriTopla(
  entitlements: Awaited<ReturnType<FirestoreEntitlementRepository['listAll']>>,
  nowMs: number,
): Map<string, TraineePackage[]> {
  const byMember = new Map<string, TraineePackage[]>()
  for (const e of entitlements) {
    if (e.status !== 'active') continue
    const until = Number(e.validUntil)
    const list = byMember.get(e.memberId as string) ?? []
    list.push({
      name: e.productSnapshot.name,
      category: e.productSnapshot.category,
      validUntil: until,
      creditsAvailable: e.credits ? available(e.credits) : null,
      remainingDays: Math.max(0, Math.ceil((until - nowMs) / 86_400_000)),
    })
    byMember.set(e.memberId as string, list)
  }
  for (const list of byMember.values()) list.sort((a, b) => b.validUntil - a.validUntil)
  return byMember
}

/**
 * The member list, as a trainer may see it: names and active packages, nothing else.
 *
 * Deleted members are excluded — a KVKK erasure leaves a tombstone, and a tombstone is not somebody a
 * trainer plans a lesson for.
 */
export async function listTraineeRows(ctx: TenantContext, nowMs: number): Promise<TraineeRow[]> {
  const db = adminDb()
  const [members, entitlements, demo] = await Promise.all([
    new FirestoreMemberRepository(db).list(ctx),
    new FirestoreEntitlementRepository(db).listAll(ctx),
    isDemoMode(),
  ])
  const byMember = paketleriTopla(entitlements, nowMs)

  return members
    .filter((m) => m.status !== 'deleted')
    .map((m) => {
      const id = m.id as string
      return {
        id,
        // Demo modu isimleri SUNUCUDA maskeler — burada da, tıpkı üye listesinde olduğu gibi.
        fullName: demo ? maskName(m.fullName, id) : m.fullName,
        packages: byMember.get(id) ?? [],
      }
    })
    .sort((a, b) => a.fullName.localeCompare(b.fullName, 'tr'))
}

/** One trainee, or `null` when the id is not a member of this studio (or has been erased). */
export async function loadTrainee(ctx: TenantContext, memberId: string, nowMs: number): Promise<TraineeRow | null> {
  const db = adminDb()
  const [member, entitlements, demo] = await Promise.all([
    new FirestoreMemberRepository(db).findById(ctx, memberId as Parameters<FirestoreMemberRepository['findById']>[1]),
    new FirestoreEntitlementRepository(db).listAll(ctx),
    isDemoMode(),
  ])
  if (!member || member.status === 'deleted') return null
  const id = member.id as string
  return {
    id,
    fullName: demo ? maskName(member.fullName, id) : member.fullName,
    packages: paketleriTopla(entitlements, nowMs).get(id) ?? [],
  }
}
