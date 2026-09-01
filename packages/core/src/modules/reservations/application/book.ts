import {
  newReservationId,
  ok,
  type ClassSessionId,
  type DomainError,
  isOverrideActiveAt,
  type EntitlementId,
  type MemberId,
  type OperationId,
  type ReservationOverride,
  type Result,
  type ReservationId,
  type TenantContext,
} from '../../../shared'
import { decideAdjust, decideHold } from '../../entitlements'
import type { MemberSnapshot } from '../../members'
import type { ServiceId } from '../../../shared'
import type { Reservation } from '../domain/types'
import { decideBooking } from '../domain/decide'
import { localMinuteOfDay, localWeekday, packageRuleFromSnapshot, resolveReservationPolicy } from '../domain/policy'
import { decideContext } from './context'
import type { BookDecision, ReservationsDeps } from './ports'

const DAY_MS = 86_400_000
const localDayNumber = (ms: number, offsetMinutes: number): number =>
  Math.floor((ms + offsetMinutes * 60_000) / DAY_MS)


// Fit Paket — the member's non-cancelled reservations for THIS service, inside the session's
// studio-local Monday–Sunday week. Counted here because a pure decider cannot query, and counted
// from reservations already in memory so it costs no extra read.
//
// Why Monday: the owner chose the calendar week, so the right resets at Monday 00:00 studio time and
// a member cannot take Sunday's slot and Monday's as "two in seven days".
//
// Cancelled is the ONLY status excluded — a timely cancellation gives the week's right back. A
// no-show is counted, so it burns, exactly as a held credit does: the seat was taken and nobody
// else could have it.
function weekServiceCount(
  reservations: readonly Reservation[],
  serviceId: ServiceId,
  sessionStartsAt: number,
  offset: number,
): number {
  const mondayOf = (at: number) => localDayNumber(at, offset) - ((localWeekday(at, offset) + 6) % 7)
  const week = mondayOf(sessionStartsAt)
  return reservations.filter(
    (r) =>
      r.status !== 'cancelled' &&
      r.sessionServiceId === serviceId &&
      mondayOf(r.sessionStartsAt as number) === week,
  ).length
}

export interface BookReservationInput {
  readonly sessionId: ClassSessionId
  // Reception may override the auto-selection; the Server Action runs
  // selectEntitlement (I-17) and passes the chosen entitlement here.
  readonly entitlementId: EntitlementId
  readonly memberId: MemberId
  readonly memberSnapshot: MemberSnapshot
  // OP-2 — set when this booking belongs to a larger operation (a promotion from the waiting
  // list, a recurring series). Omitted for a stand-alone booking.
  readonly operationId?: OperationId
  /**
   * Süresi dolmuş bir paketin YANAN hakkını bu derse saydır (owner, 2026-09-01).
   *
   * Yalnızca masanın açtığı bir kapı, ve yalnızca `entitlementId` ile AÇIKÇA gösterilen paket için.
   * Üye kendi uygulamasından buraya asla gelmez; gelseydi "süre doldu" diye bir şey kalmazdı.
   */
  readonly honourExpiredCredit?: boolean
}

// Booking = a synchronous, trusted Server-Action write (AD-35): it allocates a
// scarce seat and holds a credit, so it is never a /commands write. The transaction
// (I-10) reads session + entitlement, composes decideBooking with the credit-ledger
// hold (AD-53), and writes reservation + bookedCount + entitlement + events atomically.
export async function bookReservation(
  deps: ReservationsDeps,
  ctx: TenantContext,
  input: BookReservationInput,
): Promise<Result<{ reservationId: ReservationId }, DomainError>> {
  const dctx = decideContext(deps, ctx, input.operationId ? { operationId: input.operationId } : {})
  const reservationId = newReservationId()
  // AG-1 — read ONCE, outside the transaction. Opening hours are a studio-wide setting that changes
  // a few times a year; re-reading them inside every booking transaction would buy nothing and cost
  // a document read on the hottest path in the product.
  const hours = await deps.hours.getStudioHours(ctx)
  const offset = hours.utcOffsetMinutes

  // Package Rules 2.0 — resolve the member's override and count her open reservations ONCE, before the
  // transaction (both change rarely; a soft limit does not need the hold's atomicity). The counts use
  // the reservation's own denormalised `sessionStartsAt`, so no session read is needed here.
  // Plus Phase 4 — an override outside its validity window is INERT: the member falls back to the
  // package rules automatically, no sweep required.
  const raw = deps.policy ? await deps.policy.getMemberOverride(ctx, input.memberId) : null
  const override: ReservationOverride | null = raw && isOverrideActiveAt(raw, dctx.now) ? raw : null
  // The whole list is kept, not just the open starts: the weekly Fit Paket count needs the
  // cancelled/attended ones too (cancelled excluded, no-show counted), and re-reading would be a
  // second query for data already in hand.
  const memberReservations = await deps.repo.listByMember(ctx, input.memberId)
  const openStarts = memberReservations.filter((r) => r.status === 'booked').map((r) => r.sessionStartsAt as number)

  return deps.repo.book(ctx, {
    sessionId: input.sessionId,
    entitlementId: input.entitlementId,
    memberId: input.memberId,
    decide: (session, entitlement, memberHasBooked): Result<BookDecision, DomainError> => {
      const eff = resolveReservationPolicy(packageRuleFromSnapshot(entitlement.productSnapshot), override)
      const sessionDay = localDayNumber(session.startsAt, offset)
      const booked = decideBooking(
        dctx,
        session,
        entitlement,
        { reservationId, memberId: input.memberId, memberSnapshot: input.memberSnapshot },
        memberHasBooked,
        hours,
        {
          policy: eff,
          sessionWeekday: localWeekday(session.startsAt, offset),
          sessionStartMinutes: localMinuteOfDay(session.startsAt, offset),
          memberDayReservationCount: openStarts.filter((s) => localDayNumber(s, offset) === sessionDay).length,
          memberActiveReservationCount: openStarts.length,
          memberWeekServiceCount: weekServiceCount(memberReservations, session.serviceId, session.startsAt as number, offset),
        },
      )
      if (!booked.ok) return booked

      // Period entitlements hold nothing; credit entitlements hold one (E1).
      if (entitlement.credits === null) {
        return ok({
          reservation: booked.value.reservation,
          nextEntitlement: entitlement,
          bookedCountAfter: session.bookedCount + 1,
          events: booked.value.events,
        })
      }
      // ── YANAN HAKKI GERİ VER, SONRA HARCA (owner, 2026-09-01) ──────────────────────────────
      //
      // Süre dolarken kalan dersler `expired` kovasına yakılır ve `available` sıfırlanır. Owner'ın
      // istediği "o krediyle bir ders rezerve et" işlemi, bu yüzden bir kredi harcaması değil —
      // önce YANAN hakkın geri verilmesi, sonra normal yolundan harcanması.
      //
      // Sayaçların üstüne yazılmaz: `expired` azaltılmaz, `restored` bir artırılır — telafi kaydı,
      // sessiz düzeltme değil (#9). Sebep `correction` ve notu olayla birlikte durur, böylece
      // "kendi kuralımızı kaç kez esnettik" sorusu sonradan cevaplanabilir.
      //
      // Üyenin kalan yanık dersleri YANIK KALIR. Bir ders için bir hak; paket dirilmez.
      let ent = entitlement
      const oncekiOlaylar = [...booked.value.events]
      if (input.honourExpiredCredit && entitlement.status === 'expired') {
        const geriVer = decideAdjust(
          dctx,
          entitlement,
          1,
          'correction',
          'Süresi dolmuş pakette yanan hak, bir ders için kullanıldı (resepsiyon kararı).',
        )
        if (!geriVer.ok) return geriVer
        ent = geriVer.value.next
        oncekiOlaylar.push(...geriVer.value.events)
      }

      const hold = decideHold(dctx, ent, reservationId)
      if (!hold.ok) return hold
      return ok({
        reservation: booked.value.reservation,
        nextEntitlement: hold.value.next,
        bookedCountAfter: session.bookedCount + 1,
        events: [...oncekiOlaylar, ...hold.value.events],
      })
    },
  })
}
