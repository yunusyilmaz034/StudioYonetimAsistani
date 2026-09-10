import {
  err,
  ok,
  type ActorRef,
  type CorrelationId,
  type DomainError,
  type EventSource,
  type Instant,
  type NewEvent,
  type Result,
  type StaffRole,
  type StaffUserId,
  type StudioId,
  type BranchId,
} from '../../../shared'
import {
  STAFF_CREATED,
  STAFF_DEACTIVATED,
  STAFF_REACTIVATED,
  STAFF_ROLE_CHANGED,
  STAFF_LEAVE_APPROVED,
  STAFF_LEAVE_CANCELLED,
  STAFF_LEAVE_REJECTED,
  STAFF_LEAVE_REQUESTED,
  STAFF_SHIFT_ENDED,
  STAFF_SHIFT_STARTED,
  type StaffCreatedPayload,
  type StaffDeactivatedPayload,
  type StaffReactivatedPayload,
  type StaffRoleChangedPayload,
  type StaffShiftEndedPayload,
  type StaffShiftStartedPayload,
} from '../events'
import type { LeaveKind } from '../events'
import type { StaffLeave, StaffMember, StaffShift } from './types'

// Who may work here, and as what (v1.27 S1 · owner, 2026-07-13).
//
// Pure. No I/O, no clock, no id minting — the Auth account and the custom claims are infrastructure,
// and they are wired around this, never inside it.
//
// ── The rule that runs through all four decisions ───────────────────────────────────────────
// **Granting a role is the quietest way to widen access in this system.** Making somebody a
// receptionist hands her every member's phone number and the key to the till; it costs nothing, it
// looks like an administrative chore, and it is the single act most worth being able to explain a
// year later. So every one of these appends an event, and a deactivation carries a mandatory reason.

export interface DecideContext {
  readonly studioId: StudioId
  readonly actor: ActorRef
  readonly now: Instant
  readonly correlationId: CorrelationId
  readonly source: EventSource
}

const base = (ctx: DecideContext, staffUserId: StaffUserId) => ({
  studioId: ctx.studioId,
  branchId: null,
  version: 1,
  occurredAt: ctx.now,
  actor: ctx.actor,
  source: ctx.source,
  subject: { kind: 'staff', id: staffUserId } as const,
  related: {},
  policyRef: null,
  commandId: null,
  causationId: null,
  correlationId: ctx.correlationId,
})

/**
 * Only the owner (or the platform admin) may decide who works here.
 *
 * `actor.type`, not `role`: this is a question about WHO is acting, and the actor taxonomy exists so
 * the domain can ask it. Reception must not be able to promote herself, and — the case that actually
 * matters — must not be able to create a second account that can.
 */
function mayAdminister(ctx: DecideContext): boolean {
  return ctx.actor.type === 'owner' || ctx.actor.type === 'platform_admin'
}

export function decideCreateStaff(
  ctx: DecideContext,
  staff: StaffMember,
  existing: StaffMember | null,
): Result<NewEvent<typeof STAFF_CREATED, StaffCreatedPayload>[], DomainError> {
  if (!mayAdminister(ctx)) return err({ code: 'staff_admin_required' })
  if (staff.displayName.trim().length === 0) return err({ code: 'name_required' })
  // Idempotent: re-running the bootstrap script (or double-clicking the button) must not mint a
  // second `staff.created` for the same person and make one hiring read as two.
  if (existing) return ok([])

  return ok([
    {
      ...base(ctx, staff.id),
      type: STAFF_CREATED,
      // The NAME is not here. It is PII, it lives on `/staff`, and the log keeps the opaque id and
      // the role — the part that is analysable and the part that must survive her leaving (#6).
      payload: { staffUserId: staff.id as string, role: staff.role },
    },
  ])
}

/**
 * **A studio always has at least one active owner** (owner, 2026-07-13).
 *
 * She is the only principal who can administer staff. A studio whose last owner was demoted or
 * deactivated has locked EVERY HUMAN out of its own permission system — and the way back is a
 * developer with admin credentials running a break-glass script. The refusal costs a click; the
 * recovery costs a phone call to someone who may be on holiday.
 *
 * Note what this rule does NOT forbid: an owner stepping back once a second owner exists. Succession
 * is a thing a studio does, and the invariant is *"at least one"*, not *"you, forever"*.
 */
function isLastActiveOwner(target: StaffMember, activeOwnerCount: number): boolean {
  return target.role === 'owner' && target.active && activeOwnerCount <= 1
}

export function decideChangeRole(
  ctx: DecideContext,
  current: StaffMember,
  to: StaffRole,
  activeOwnerCount: number,
): Result<
  { next: StaffMember; events: NewEvent<typeof STAFF_ROLE_CHANGED, StaffRoleChangedPayload>[] },
  DomainError
> {
  if (!mayAdminister(ctx)) return err({ code: 'staff_admin_required' })
  if (current.role === to) return ok({ next: current, events: [] }) // idempotent, and not an error

  if (isLastActiveOwner(current, activeOwnerCount)) return err({ code: 'last_owner_required' })

  return ok({
    next: { ...current, role: to },
    events: [
      {
        ...base(ctx, current.id),
        type: STAFF_ROLE_CHANGED,
        // BOTH directions. "Ayşe became a receptionist" does not tell you whether that widened her
        // access or narrowed it, and a year later that is the only thing you want to know.
        payload: { staffUserId: current.id as string, from: current.role, to },
      },
    ],
  })
}

export function decideDeactivateStaff(
  ctx: DecideContext,
  current: StaffMember,
  reason: string,
  actingUserId: StaffUserId,
  activeOwnerCount: number,
): Result<
  { next: StaffMember; events: NewEvent<typeof STAFF_DEACTIVATED, StaffDeactivatedPayload>[] },
  DomainError
> {
  if (!mayAdminister(ctx)) return err({ code: 'staff_admin_required' })
  // A departure with no recorded reason is indistinguishable from an account somebody quietly
  // removed, and this is exactly the kind of act an audit exists for.
  if (reason.trim().length === 0) return err({ code: 'reason_required' })
  // Disabling your own login is a footgun with no upside: you are locked out this second, and the
  // person who can let you back in is the colleague you were about to ask anyway.
  if (current.id === actingUserId) return err({ code: 'cannot_deactivate_self' })
  if (isLastActiveOwner(current, activeOwnerCount)) return err({ code: 'last_owner_required' })
  if (!current.active) return ok({ next: current, events: [] }) // already gone

  return ok({
    next: { ...current, active: false },
    events: [
      {
        ...base(ctx, current.id),
        type: STAFF_DEACTIVATED,
        payload: { staffUserId: current.id as string, reason },
      },
    ],
  })
}

export function decideReactivateStaff(
  ctx: DecideContext,
  current: StaffMember,
): Result<
  { next: StaffMember; events: NewEvent<typeof STAFF_REACTIVATED, StaffReactivatedPayload>[] },
  DomainError
> {
  if (!mayAdminister(ctx)) return err({ code: 'staff_admin_required' })
  if (current.active) return ok({ next: current, events: [] })

  return ok({
    next: { ...current, active: true },
    events: [
      {
        ...base(ctx, current.id),
        type: STAFF_REACTIVATED,
        payload: { staffUserId: current.id as string },
      },
    ],
  })
}

// ── MESAİ (owner, 2026-09-01) ───────────────────────────────────────────────────────────────
//
// Günde iki karar: başladım, bitirdim. Saf, çünkü "şimdi"yi de kimliği de dışarıdan alıyor.
//
// Kendi vardiyasını herkes kendi yazar — bir başkasının adına mesai yazmak, bu ekranın işi değil.
// Owner bir düzeltme yapacaksa bunun yolu bir telafi kaydıdır, sessizce başkasının saatini
// değiştirmek değil (#9).

export function decideStartShift(
  ctx: DecideContext,
  input: { readonly staffUserId: StaffUserId; readonly shiftId: string; readonly branchId: BranchId | null },
  acik: StaffShift | null,
): Result<NewEvent<typeof STAFF_SHIFT_STARTED, StaffShiftStartedPayload>[], DomainError> {
  if (!kendisi(ctx, input.staffUserId)) return err({ code: 'own_shift_only' })
  // Zaten açık bir vardiya varken ikincisini açmak, gün sonunda hangisinin gerçek olduğunu
  // bilinemez yapar. Reddediyoruz — sessizce kapatıp yenisini açmak, olmamış bir çıkışı yazmak olur.
  if (acik) return err({ code: 'shift_already_open' })
  return ok([
    {
      ...base(ctx, input.staffUserId),
      branchId: input.branchId,
      type: STAFF_SHIFT_STARTED,
      payload: { staffUserId: input.staffUserId, shiftId: input.shiftId },
    },
  ])
}

export function decideEndShift(
  ctx: DecideContext,
  acik: StaffShift | null,
): Result<NewEvent<typeof STAFF_SHIFT_ENDED, StaffShiftEndedPayload>[], DomainError> {
  if (!acik) return err({ code: 'no_open_shift' })
  if (!kendisi(ctx, acik.staffUserId)) return err({ code: 'own_shift_only' })
  return ok([
    {
      ...base(ctx, acik.staffUserId),
      branchId: acik.branchId,
      type: STAFF_SHIFT_ENDED,
      payload: {
        staffUserId: acik.staffUserId,
        shiftId: acik.id,
        // Aşağı yuvarlanıyor: 59 saniye bir dakika değildir. Saniyeyi hiç yazmıyoruz, çünkü
        // kimse bir vardiyayı saniyesiyle sormuyor.
        minutes: Math.max(0, Math.floor(((ctx.now as number) - (acik.startedAt as number)) / 60_000)),
      },
    },
  ])
}

/** Kendi vardiyası mı? Platform yöneticisi hariç kimse bir başkasının saatini yazamaz. */
function kendisi(ctx: DecideContext, staffUserId: StaffUserId): boolean {
  return ctx.actor.type === 'platform_admin' || String(ctx.actor.id) === String(staffUserId)
}

// ── İZİN / YOKLUK (owner onayı, 2026-09-11) ─────────────────────────────────────────────────
//
// Kurallar burada, ve az: talep edilen aralık geçerli olmalı, aynı kişi aynı günlere iki kez izin
// alamamalı, ve kararı ancak owner verebilmeli. Bakiye aritmetiği YOK — bilerek (bkz. `events.ts`).

const GUN = 86_400_000

/** İki yokluk aralığı çakışıyor mu? Uçlar DAHİL: 12–15 ile 15–18 aynı günü paylaşıyor. */
const cakisiyor = (aFrom: Instant, aTo: Instant, bFrom: Instant, bTo: Instant): boolean =>
  aFrom <= bTo && bFrom <= aTo

export function decideRequestLeave(
  ctx: DecideContext,
  input: {
    readonly leaveId: string
    readonly staffUserId: StaffUserId
    readonly kind: LeaveKind
    readonly from: Instant
    readonly to: Instant
    readonly note: string
  },
  mevcut: readonly StaffLeave[],
): Result<{ next: StaffLeave; events: NewEvent[] }, DomainError> {
  // Başkasının adına izin isteyemezsin. Owner bir çalışanın izninu KENDİSİ girecekse yine bu yoldan
  // geçer ve `platform_admin` istisnası onu geçirir — ama olayda aktör olarak o görünür.
  if (!kendisi(ctx, input.staffUserId)) return err({ code: 'own_shift_only' })
  if (input.to < input.from) return err({ code: 'invalid_range' })
  // Geçmişe izin YAZILABİLİR — rapor dün alınır ve ertesi gün girilir. Ama bu bir düzeltmedir ve
  // gelecekteki bir izinle aynı şey değil; ayrımı `requestedAt` ile `from` arasındaki fark taşıyor.

  // ÇAKIŞMA REDDEDİLİR. İki üst üste izin, "bu gün izinli mi" sorusunun iki cevabı demektir ve
  // takvimdeki etkiyi hesaplarken hangisinin geçerli olduğu bilinemez.
  for (const m of mevcut) {
    if (m.status !== 'pending' && m.status !== 'approved') continue
    if (String(m.staffUserId) !== String(input.staffUserId)) continue
    if (cakisiyor(input.from, input.to, m.from, m.to)) return err({ code: 'leave_overlaps' })
  }

  const next: StaffLeave = {
    id: input.leaveId,
    staffUserId: input.staffUserId,
    kind: input.kind,
    from: input.from,
    to: input.to,
    note: input.note.trim(),
    status: 'pending',
    requestedAt: ctx.now,
    decidedBy: null,
    decidedAt: null,
    decisionReason: '',
  }
  return ok({
    next,
    events: [
      {
        ...base(ctx, input.staffUserId),
        type: STAFF_LEAVE_REQUESTED,
        payload: {
          leaveId: input.leaveId,
          staffUserId: String(input.staffUserId),
          kind: input.kind,
          fromMs: input.from,
          toMs: input.to,
          days: Math.max(1, Math.round((input.to - input.from) / GUN)),
          // Notun KENDİSİ olayda yok: serbest metin, PII'nin sızdığı yerdir (#6). Not durum
          // belgesinde duruyor ve silinebiliyor; olay silinemez.
          hasNote: next.note.length > 0,
        },
      },
    ],
  })
}

/**
 * Onay ya da red. `affectedSessions` DIŞARIDAN geliyor: takvimi okumak I/O'dur ve burası saf.
 *
 * O sayının olaya yazılmasının sebebi, altı ay sonra sorulacak tek soru: onaylayan kişi kaç dersin
 * sahipsiz kalacağını GÖRDÜ mü? Gördüyse bu satır onu söylüyor.
 */
export function decideDecideLeave(
  ctx: DecideContext,
  leave: StaffLeave,
  karar: { readonly approve: true; readonly affectedSessions: number } | { readonly approve: false; readonly reason: string },
): Result<{ next: StaffLeave; events: NewEvent[] }, DomainError> {
  if (leave.status !== 'pending') return err({ code: 'operation_not_applicable' })
  // KARARI SAHİBİ VEREMEZ. Kendi iznini onaylamak, onayı bir tıklamaya indirger — ve o zaman
  // onay diye bir şey yoktur, yalnızca bir form vardır.
  if (String(ctx.actor.id) === String(leave.staffUserId) && ctx.actor.type !== 'platform_admin')
    return err({ code: 'own_shift_only' })

  if (!karar.approve) {
    if (karar.reason.trim() === '') return err({ code: 'reason_required' })
    return ok({
      next: { ...leave, status: 'rejected', decidedBy: ctx.actor.id as StaffUserId, decidedAt: ctx.now, decisionReason: karar.reason.trim() },
      events: [
        {
          ...base(ctx, leave.staffUserId),
          type: STAFF_LEAVE_REJECTED,
          payload: { leaveId: leave.id, staffUserId: String(leave.staffUserId), reason: karar.reason.trim() },
        },
      ],
    })
  }

  return ok({
    next: { ...leave, status: 'approved', decidedBy: ctx.actor.id as StaffUserId, decidedAt: ctx.now, decisionReason: '' },
    events: [
      {
        ...base(ctx, leave.staffUserId),
        type: STAFF_LEAVE_APPROVED,
        payload: { leaveId: leave.id, staffUserId: String(leave.staffUserId), affectedSessions: karar.affectedSessions },
      },
    ],
  })
}

/** Geri çekme: sahibi bekleyen talebini, owner onaylanmış izni de geri alabilir. */
export function decideCancelLeave(
  ctx: DecideContext,
  leave: StaffLeave,
): Result<{ next: StaffLeave; events: NewEvent[] }, DomainError> {
  if (leave.status === 'cancelled' || leave.status === 'rejected') return err({ code: 'operation_not_applicable' })
  const sahibi = kendisi(ctx, leave.staffUserId)
  const yetkili = ctx.actor.type === 'owner' || ctx.actor.type === 'platform_admin'
  // Onaylanmış bir izni sahibi tek başına geri alamaz: o izne göre ders programı değişmiş olabilir.
  if (leave.status === 'approved' ? !yetkili : !(sahibi || yetkili)) return err({ code: 'own_shift_only' })
  return ok({
    next: { ...leave, status: 'cancelled', decidedBy: ctx.actor.id as StaffUserId, decidedAt: ctx.now },
    events: [
      {
        ...base(ctx, leave.staffUserId),
        type: STAFF_LEAVE_CANCELLED,
        payload: { leaveId: leave.id, staffUserId: String(leave.staffUserId), wasApproved: leave.status === 'approved' },
      },
    ],
  })
}
