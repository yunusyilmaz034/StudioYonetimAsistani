import {
  getFirestore,
  Timestamp,
  type CollectionReference,
  type Firestore,
  type Transaction,
} from 'firebase-admin/firestore'

import {
  entitlementFromFirestore,
  entitlementToFirestore,
} from '../../entitlements'
import { sessionFromFirestore } from '../../scheduling'
import type { DomainError, Instant, NewEvent, ReservationId, Result, StudioId, TenantContext } from '../../../shared'
import type { BookTxInput, CancelTxInput, ResolveTxInput, ReservationRepository } from '../application/ports'
import type { Reservation } from '../domain/types'
import { eventToFirestore, reservationFromFirestore, reservationToFirestore } from './mappers'

// Thrown to abort a transaction with a typed domain refusal (Firestore does not
// retry on a non-Firestore throw); caught at the boundary and returned as `err`.
class TxAbort extends Error {
  constructor(readonly domainError: DomainError) {
    super(domainError.code)
  }
}

export class FirestoreReservationRepository implements ReservationRepository {
  constructor(private readonly db: Firestore = getFirestore()) {}

  private col(sid: StudioId, name: string): CollectionReference {
    return this.db.collection('studios').doc(sid).collection(name)
  }

  private writeEvents(sid: StudioId, tx: Transaction, events: readonly NewEvent[]): void {
    for (const e of events) {
      const { id, data } = eventToFirestore(e)
      tx.set(this.col(sid, 'events').doc(id), data)
    }
  }

  async getReservation(ctx: TenantContext, id: ReservationId): Promise<Reservation | null> {
    const s = await this.col(ctx.studioId, 'reservations').doc(id).get()
    const d = s.data()
    return d ? reservationFromFirestore(id, d) : null
  }

  async book(
    ctx: TenantContext,
    input: BookTxInput,
  ): Promise<Result<{ reservationId: ReservationId }, DomainError>> {
    const sid = ctx.studioId
    const sessionRef = this.col(sid, 'classSessions').doc(input.sessionId)
    const entRef = this.col(sid, 'entitlements').doc(input.entitlementId)
    const dupQuery = this.col(sid, 'reservations')
      .where('memberId', '==', input.memberId)
      .where('classSessionId', '==', input.sessionId)
      .where('status', '==', 'booked')

    try {
      const reservationId = await this.db.runTransaction(async (tx) => {
        const [sessSnap, entSnap, dupSnap] = await Promise.all([
          tx.get(sessionRef),
          tx.get(entRef),
          tx.get(dupQuery),
        ])
        if (!sessSnap.exists) throw new Error(`ClassSession not found: ${input.sessionId}`)
        if (!entSnap.exists) throw new Error(`Entitlement not found: ${input.entitlementId}`)

        const session = sessionFromFirestore(input.sessionId, sessSnap.data() ?? {})
        const entitlement = entitlementFromFirestore(input.entitlementId, entSnap.data() ?? {})
        const decided = input.decide(session, entitlement, !dupSnap.empty)
        if (!decided.ok) throw new TxAbort(decided.error)

        const { reservation, nextEntitlement, bookedCountAfter, events } = decided.value
        tx.set(this.col(sid, 'reservations').doc(reservation.id), reservationToFirestore(reservation))
        tx.update(sessionRef, { bookedCount: bookedCountAfter })
        tx.set(entRef, entitlementToFirestore(nextEntitlement))
        this.writeEvents(sid, tx, events)
        return reservation.id
      })
      return { ok: true, value: { reservationId } }
    } catch (e) {
      if (e instanceof TxAbort) return { ok: false, error: e.domainError }
      throw e
    }
  }

  async cancel(ctx: TenantContext, input: CancelTxInput): Promise<Result<void, DomainError>> {
    const sid = ctx.studioId
    const reservationRef = this.col(sid, 'reservations').doc(input.reservationId)

    try {
      await this.db.runTransaction(async (tx) => {
        const resSnap = await tx.get(reservationRef)
        if (!resSnap.exists) throw new Error(`Reservation not found: ${input.reservationId}`)
        const reservation = reservationFromFirestore(input.reservationId, resSnap.data() ?? {})

        const sessionRef = this.col(sid, 'classSessions').doc(reservation.classSessionId)
        const entRef = this.col(sid, 'entitlements').doc(reservation.entitlementId)
        const [sessSnap, entSnap] = await Promise.all([tx.get(sessionRef), tx.get(entRef)])
        if (!sessSnap.exists) throw new Error(`ClassSession not found: ${reservation.classSessionId}`)
        if (!entSnap.exists) throw new Error(`Entitlement not found: ${reservation.entitlementId}`)

        const session = sessionFromFirestore(reservation.classSessionId, sessSnap.data() ?? {})
        const entitlement = entitlementFromFirestore(reservation.entitlementId, entSnap.data() ?? {})
        const decided = input.decide(reservation, session, entitlement)
        if (!decided.ok) throw new TxAbort(decided.error)

        const { reservation: next, nextEntitlement, bookedCountAfter, events } = decided.value
        tx.set(reservationRef, reservationToFirestore(next))
        tx.update(sessionRef, { bookedCount: bookedCountAfter })
        if (nextEntitlement) tx.set(entRef, entitlementToFirestore(nextEntitlement))
        this.writeEvents(sid, tx, events)
      })
      return { ok: true, value: undefined }
    } catch (e) {
      if (e instanceof TxAbort) return { ok: false, error: e.domainError }
      throw e
    }
  }

  // Resolution (attendance mark, auto-resolve, correction): reservation + entitlement
  // move together; the seat count does not. Mirrors `cancel` minus the bookedCount
  // write. A period entitlement yields `nextEntitlement: null` and no ledger write.
  async resolve(ctx: TenantContext, input: ResolveTxInput): Promise<Result<void, DomainError>> {
    const sid = ctx.studioId
    const reservationRef = this.col(sid, 'reservations').doc(input.reservationId)

    try {
      await this.db.runTransaction(async (tx) => {
        const resSnap = await tx.get(reservationRef)
        if (!resSnap.exists) throw new Error(`Reservation not found: ${input.reservationId}`)
        const reservation = reservationFromFirestore(input.reservationId, resSnap.data() ?? {})

        const sessionRef = this.col(sid, 'classSessions').doc(reservation.classSessionId)
        const entRef = this.col(sid, 'entitlements').doc(reservation.entitlementId)
        const [sessSnap, entSnap] = await Promise.all([tx.get(sessionRef), tx.get(entRef)])
        if (!sessSnap.exists) throw new Error(`ClassSession not found: ${reservation.classSessionId}`)
        if (!entSnap.exists) throw new Error(`Entitlement not found: ${reservation.entitlementId}`)

        const session = sessionFromFirestore(reservation.classSessionId, sessSnap.data() ?? {})
        const entitlement = entitlementFromFirestore(reservation.entitlementId, entSnap.data() ?? {})
        const decided = input.decide(reservation, session, entitlement)
        if (!decided.ok) throw new TxAbort(decided.error)

        const { reservation: next, nextEntitlement, events } = decided.value
        tx.set(reservationRef, reservationToFirestore(next))
        if (nextEntitlement) tx.set(entRef, entitlementToFirestore(nextEntitlement))
        this.writeEvents(sid, tx, events)
      })
      return { ok: true, value: undefined }
    } catch (e) {
      if (e instanceof TxAbort) return { ok: false, error: e.domainError }
      throw e
    }
  }

  async listResolvableBooked(
    ctx: TenantContext,
    endedAtOrBefore: Instant,
  ): Promise<readonly Reservation[]> {
    const snap = await this.col(ctx.studioId, 'reservations')
      .where('status', '==', 'booked')
      .where('sessionEndsAt', '<=', Timestamp.fromMillis(endedAtOrBefore))
      .get()
    return snap.docs.map((doc) => reservationFromFirestore(doc.id as ReservationId, doc.data()))
  }

  // The day's reservations for the attendance roster read — one range query over the
  // denormalised `sessionStartsAt`, grouped by session on the client.
  async listBySessionStartRange(
    ctx: TenantContext,
    fromInclusive: Instant,
    toExclusive: Instant,
  ): Promise<readonly Reservation[]> {
    const snap = await this.col(ctx.studioId, 'reservations')
      .where('sessionStartsAt', '>=', Timestamp.fromMillis(fromInclusive))
      .where('sessionStartsAt', '<', Timestamp.fromMillis(toExclusive))
      .get()
    return snap.docs.map((doc) => reservationFromFirestore(doc.id as ReservationId, doc.data()))
  }
}
