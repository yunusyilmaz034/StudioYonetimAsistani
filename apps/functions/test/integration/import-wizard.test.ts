import {
  applyImport,
  decideRevert,
  FirestoreEntitlementRepository,
  FirestoreImportBatchRepository,
  FirestoreMemberRepository,
  money,
  newImportBatchId,
  normalizePhone,
  revertImport,
  systemClock,
  type BranchId,
  type EntitlementActivity,
  type ImportModuleDeps,
  type ImportProduct,
  type MemberActivity,
  type MemberId,
  type NormalizePhone,
  type ProductId,
  type StudioId,
  type TenantContext,
} from '@studio/core'
import { beforeEach, describe, expect, it } from 'vitest'

import { db } from '../../src/shared/firebase'

// THE IMPORT, AGAINST A REAL DATABASE.
//
// The pure layers are covered by unit tests: which rows are valid, whose package is whose, whether a
// batch may be reverted. None of that touches Firestore. What is tested HERE is the part that
// actually writes — and the part where the promises made elsewhere either hold or do not:
//
//   · an import creates members and grants packages with the OPENING BALANCE, not the full count;
//   · it writes NO money, which is the owner's rule and the easiest thing to break by accident;
//   · the batch record knows everything it created, even though nothing is transactional;
//   · a reversal undoes exactly that set and nothing else;
//   · a batch that has been touched cannot be reverted.
//
// A unit test cannot reach any of these: they are all statements about what ended up in the
// database.

const SID = 'std_import_test' as StudioId
const BRANCH = 'brn_1' as BranchId
const PRODUCT = 'prd_reformer_8' as ProductId

const ctx: TenantContext = {
  studioId: SID,
  branchIds: [BRANCH],
  role: 'owner',
  actor: { type: 'owner', id: 'usr_owner' as never },
}

const normalize: NormalizePhone = (raw) => {
  const r = normalizePhone(raw)
  return r.ok ? { e164: r.value.e164, normalized: r.value.normalized } : null
}

function deps(): ImportModuleDeps {
  return {
    batches: new FirestoreImportBatchRepository(db()),
    clock: systemClock,
    members: { repo: new FirestoreMemberRepository(db()), clock: systemClock, source: 'migration' },
    entitlements: { repo: new FirestoreEntitlementRepository(db()), clock: systemClock },
  }
}

const CATALOGUE: readonly ImportProduct[] = [
  {
    productId: PRODUCT,
    freezeDays: null,
    snapshot: {
      productId: PRODUCT,
      name: 'Reformer Pilates - 8 Ders',
      category: 'pilates_group',
      grant: { kind: 'credits', credits: 8, validForDays: 30 },
      listPrice: money(420_000),
      serviceIds: ['svc_1' as never],
      cancellationAllowanceCount: null,
      dailyReservationLimit: null,
      activeReservationLimit: null,
      entryAllowance: null,
    },
  },
]

const MEMBER_MAP = { fullName: 0, phone: 1, email: null, birthDate: null, notes: null }
const PACKAGE_MAP = {
  fullName: 0, phone: 1, productName: 2, remainingCredits: 3, validUntil: 4, validFrom: null, note: null,
}

const base = {
  branchId: BRANCH,
  defaults: {},
  headerRowIndex: 0,
  normalize,
  utcOffsetMinutes: 180,
  appliedBy: 'usr_owner',
  resolutions: [],
  products: [{ productId: PRODUCT, name: 'Reformer Pilates - 8 Ders' }],
  catalogue: CATALOGUE,
  existing: [],
}

async function wipe(): Promise<void> {
  for (const col of ['members', 'members_by_phone', 'entitlements', 'events', 'importBatches', 'reservations']) {
    const snap = await db().collection(`studios/${SID}/${col}`).get()
    await Promise.all(snap.docs.map((d) => d.ref.delete()))
  }
}

describe('aktarım sihirbazı — gerçek veritabanı', () => {
  beforeEach(wipe)

  it('imports members and records every one on the batch', async () => {
    const batchId = newImportBatchId()
    const res = await applyImport(deps(), ctx, {
      ...base,
      batchId,
      kind: 'members',
      fileName: 'uyeler.xlsx',
      mapping: MEMBER_MAP,
      rows: [
        ['Ad Soyad', 'Telefon'],
        ['AYŞE YILMAZ', '05321111111'],
        ['ARZU KAYA', '05322222222'],
      ],
    })

    expect(res.createdMemberIds).toHaveLength(2)
    expect(res.failed).toEqual([])

    const members = await db().collection(`studios/${SID}/members`).get()
    expect(members.size).toBe(2)

    // The batch is the map a reversal follows. It is written per record, not at the end — a crash
    // mid-loop must still leave a findable, revertible record.
    const batch = await new FirestoreImportBatchRepository(db()).get(ctx, batchId)
    expect(batch?.createdMemberIds).toHaveLength(2)
    expect(batch?.status).toBe('applied')
  })

  it('rejects a duplicate phone instead of merging — and says so in `skipped`', async () => {
    const first = await applyImport(deps(), ctx, {
      ...base,
      batchId: newImportBatchId(),
      kind: 'members',
      fileName: 'a.csv',
      mapping: MEMBER_MAP,
      rows: [['Ad', 'Tel'], ['AYŞE YILMAZ', '05321111111']],
    })
    expect(first.createdMemberIds).toHaveLength(1)

    const existing = (await db().collection(`studios/${SID}/members`).get()).docs.map((d) => ({
      memberId: d.id as MemberId,
      fullName: String(d.data().fullName),
      phoneNormalized: String(d.data().phoneNormalized),
    }))

    const second = await applyImport(deps(), ctx, {
      ...base,
      existing,
      batchId: newImportBatchId(),
      kind: 'members',
      fileName: 'a.csv',
      mapping: MEMBER_MAP,
      rows: [['Ad', 'Tel'], ['AYŞE Y.', '0532 111 11 11']],
    })

    expect(second.createdMemberIds).toEqual([])
    expect(second.skipped).toBe(1)
    expect((await db().collection(`studios/${SID}/members`).get()).size).toBe(1)
  })

  it('grants the OPENING BALANCE and writes no money at all', async () => {
    const batchId = newImportBatchId()
    const res = await applyImport(deps(), ctx, {
      ...base,
      batchId,
      kind: 'member_packages',
      fileName: 'paketler.xlsx',
      mapping: PACKAGE_MAP,
      rows: [
        ['Ad', 'Tel', 'Paket', 'Kalan', 'Bitiş'],
        ['AYŞE YILMAZ', '05321111111', 'Reformer Pilates - 8 Ders', '5', '19.08.2026'],
      ],
    })

    expect(res.createdEntitlementIds).toHaveLength(1)
    const ent = (await db().doc(`studios/${SID}/entitlements/${res.createdEntitlementIds[0]}`).get()).data()!

    // She bought EIGHT under the old system and used three there. The package keeps its real size
    // and she arrives with five of eight (OR-9) — not a five-class package.
    expect(ent.credits.granted).toBe(8)
    const c = ent.credits
    const available = c.granted + c.restored - c.consumed - c.held - c.revoked - c.expired
    expect(available).toBe(5)

    // And the three she used elsewhere land in REVOKED, not in `consumed`. `consumed` means a class
    // in THIS studio took the credit; three classes she took under the old system did not happen
    // here, and writing them as consumed would invent attendance this system never observed.
    expect(c.revoked).toBe(3)
    expect(c.consumed).toBe(0)

    // ── The owner's rule: an import writes NO money ──────────────────────────────────────────
    expect(ent.priceAgreed.amount).toBe(0)
    expect(ent.paidTotal.amount).toBe(0)

    const events = (await db().collection(`studios/${SID}/events`).get()).docs.map((d) => d.data().type)
    for (const moneyEvent of ['sale.created', 'payment.received', 'entitlement.payment_recorded']) {
      expect(events, `import emitted ${moneyEvent}`).not.toContain(moneyEvent)
    }
    expect((await db().collection(`studios/${SID}/payments`).get()).size).toBe(0)
  })

  it('reverts a batch: packages cancelled, members deactivated, nothing deleted', async () => {
    const batchId = newImportBatchId()
    const applied = await applyImport(deps(), ctx, {
      ...base,
      batchId,
      kind: 'member_packages',
      fileName: 'paketler.xlsx',
      mapping: PACKAGE_MAP,
      rows: [
        ['Ad', 'Tel', 'Paket', 'Kalan', 'Bitiş'],
        ['AYŞE YILMAZ', '05321111111', 'Reformer Pilates - 8 Ders', '5', '19.08.2026'],
      ],
    })

    const repo = new FirestoreImportBatchRepository(db())
    const batch = (await repo.get(ctx, batchId))!
    expect(decideRevert(batch, [], [])).toEqual({ ok: true })

    const done = await revertImport(deps(), ctx, batch, 'Yanlış dosya')
    expect(done).toEqual({ revertedMembers: 1, revertedEntitlements: 1 })

    // Deactivated and cancelled — NOT deleted. An event is never deleted and neither is the record
    // it describes; six months from now "where did she come from and what happened" still answers.
    const member = (await db().doc(`studios/${SID}/members/${applied.createdMemberIds[0]}`).get()).data()!
    expect(member.status).toBe('inactive')
    const ent = (await db().doc(`studios/${SID}/entitlements/${applied.createdEntitlementIds[0]}`).get()).data()!
    expect(ent.status).toBe('cancelled')

    const after = (await repo.get(ctx, batchId))!
    expect(after.status).toBe('reverted')
    expect(after.revertReason).toBe('Yanlış dosya')
  })

  it('refuses to revert once an imported member has booked', async () => {
    const batchId = newImportBatchId()
    const applied = await applyImport(deps(), ctx, {
      ...base,
      batchId,
      kind: 'members',
      fileName: 'uyeler.csv',
      mapping: MEMBER_MAP,
      rows: [['Ad', 'Tel'], ['AYŞE YILMAZ', '05321111111']],
    })
    const memberId = applied.createdMemberIds[0]!

    // Something real happened on top of the import. From here it is no longer "a bad import" — it
    // is a record with a class hanging off it, and cancelling it would strand that class against a
    // member who officially never joined.
    const activity: MemberActivity[] = [
      { memberId, fullName: 'AYŞE YILMAZ', reservations: 1, checkIns: 0, payments: 0, otherEntitlements: 0 },
    ]
    const batch = (await new FirestoreImportBatchRepository(db()).get(ctx, batchId))!
    const verdict = decideRevert(batch, activity, [] as EntitlementActivity[])

    expect(verdict).toMatchObject({ ok: false, code: 'batch_touched' })
    if (verdict.ok || verdict.code !== 'batch_touched') throw new Error('unreachable')
    expect(verdict.blockers[0]).toEqual({ subject: 'AYŞE YILMAZ', because: '1 rezervasyon' })
  })

  it('carries on past a bad row and reports it, rather than abandoning the file', async () => {
    // Seventy rows cannot be one transaction. A single unusable row must not cost the other
    // sixty-nine — it is reported with its line number and the rest still land.
    const res = await applyImport(deps(), ctx, {
      ...base,
      batchId: newImportBatchId(),
      kind: 'members',
      fileName: 'uyeler.csv',
      mapping: MEMBER_MAP,
      rows: [
        ['Ad', 'Tel'],
        ['AYŞE YILMAZ', '05321111111'],
        ['BOZUK SATIR', 'telefon-değil'],
        ['ARZU KAYA', '05322222222'],
      ],
    })

    expect(res.createdMemberIds).toHaveLength(2)
    expect(res.skipped).toBe(1)
    expect((await db().collection(`studios/${SID}/members`).get()).size).toBe(2)
  })
})

// ── A phone typed at the desk is as good as one from the file (owner, 2026-07-30) ────────────
//
// The studio's real export has rows with no phone. "The file has no phone" and "there is no phone"
// are different problems, and only the second one is ours to refuse — she knows the number, the
// spreadsheet just did not carry it. Dropping those rows would leave a handful of members out of a
// 74-row import for a reason she can fix in five seconds.
describe('aktarım — elle girilen telefon', () => {
  beforeEach(wipe)

  it('creates the member from a phone typed on the matching step', async () => {
    const res = await applyImport(deps(), ctx, {
      ...base,
      batchId: newImportBatchId(),
      kind: 'member_packages',
      fileName: 'fitness.xlsx',
      mapping: { ...PACKAGE_MAP, phone: null },
      rows: [
        ['Ad', 'Tel', 'Paket', 'Kalan', 'Bitiş'],
        ['GİZEM BATMAZ', '', 'Reformer Pilates - 8 Ders', '5', '19.08.2026'],
      ],
      resolutions: [{ line: 2, memberId: null, skip: false, phone: '0532 111 11 11' }],
    })

    expect(res.failed).toEqual([])
    expect(res.createdMemberIds).toHaveLength(1)
    expect(res.createdEntitlementIds).toHaveLength(1)

    const member = (await db().doc(`studios/${SID}/members/${res.createdMemberIds[0]}`).get()).data()!
    expect(member.fullName).toBe('GİZEM BATMAZ')
    // Normalised exactly like an imported one — a typed number gets no special treatment.
    expect(member.phone).toBe('+905321111111')
  })

  it('still refuses a typed phone that is not a phone', async () => {
    const res = await applyImport(deps(), ctx, {
      ...base,
      batchId: newImportBatchId(),
      kind: 'member_packages',
      fileName: 'fitness.xlsx',
      mapping: { ...PACKAGE_MAP, phone: null },
      rows: [['Ad', 'Tel', 'Paket', 'Kalan', 'Bitiş'], ['GİZEM', '', 'Reformer Pilates - 8 Ders', '5', '19.08.2026']],
      resolutions: [{ line: 2, memberId: null, skip: false, phone: '123' }],
    })

    expect(res.createdMemberIds).toEqual([])
    expect(res.failed[0]).toMatchObject({ line: 2, reason: 'yeni üye için telefon gerekli' })
    // Reported with its line, never guessed at. A phone we cannot read is how one woman's record
    // ends up reachable only at another woman's number.
  })
})
