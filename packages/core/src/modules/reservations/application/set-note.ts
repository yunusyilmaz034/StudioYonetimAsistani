import {
  ok,
  type DomainError,
  type ReservationId,
  type Result,
  type TenantContext,
} from '../../../shared'
import { decideSetReservationNote } from '../domain/decide'
import { decideContext } from './context'
import type { ReservationsDeps } from './ports'

export interface SetReservationNoteInput {
  readonly reservationId: ReservationId
  readonly text: string
}

// Set (or clear) the staff quick note (Hızlı Not). A note is metadata — it moves no
// credit and touches no session — so it is a simple state+event write, not a
// transaction. Empty text clears the note.
export async function setReservationNote(
  deps: ReservationsDeps,
  ctx: TenantContext,
  input: SetReservationNoteInput,
): Promise<Result<void, DomainError>> {
  const current = await deps.repo.getReservation(ctx, input.reservationId)
  if (!current) throw new Error(`Reservation not found: ${input.reservationId}`)
  const dctx = decideContext(deps, ctx)
  const events = decideSetReservationNote(dctx, current, input.text)
  if (!events.ok) return events
  const text = input.text.trim()
  const nextNote = text.length === 0 ? null : { text, setAt: dctx.now }
  await deps.repo.applyNote(ctx, { ...current, note: nextNote }, events.value)
  return ok(undefined)
}
