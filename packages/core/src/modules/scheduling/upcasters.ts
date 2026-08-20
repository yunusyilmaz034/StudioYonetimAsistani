import { defaultAdmission } from './domain/types'
import type { ClassSessionScheduledPayload } from './events'

// Upcasters (Doc 4 §versioning). An event is NEVER rewritten — the log is append-only and
// immutable (unbreakable #1, #9). So a reader that wants today's shape must be able to read
// yesterday's, and that translation lives here, in one place, forever.
//
// **The rule an upcaster must obey: it may only supply what the old shape MEANT. It never
// invents a value it cannot know.** The two upcasts below are exactly the two sides of that
// rule, which is why they behave differently:
//
// `class_session.scheduled`
//   v1 → v2 (D13): v1 predates PT ownership. A session written then had no assigned member —
//     not "an unknown member", but *no* member: it was studio inventory. `assignedMemberId:
//     null` is therefore a FACT about v1, and the upcaster states it.
//
//   v2 → v3 (D14): v2 predates the cancellation-window chain, and the old payload simply did
//     not record which window the session was created under. That value is NOT recoverable
//     from the payload — deriving it from today's settings would be a lie, because those
//     settings may have changed since. So the upcast yields `null`, which reads as **"not
//     recorded"**, not as "no window". The session DOCUMENT still carries the real number
//     (it always did), and that is what the cancel decider has always used.

//   v3 → v4 (Fit Paket): the OTHER kind of upcast. A v3 session admitted exactly one category —
//     its own — and capped nothing. That is not a guess about missing data; it is what the shape
//     MEANT, the same way `assignedMemberId: null` was what v1 meant. So the upcaster states it.

type ClassSessionScheduledV1 = Omit<
  ClassSessionScheduledPayload,
  'assignedMemberId' | 'cancellationWindowHours' | 'cancellationWindowSource' | 'admission'
>
type ClassSessionScheduledV2 = Omit<
  ClassSessionScheduledPayload,
  'cancellationWindowHours' | 'cancellationWindowSource' | 'admission'
>
type ClassSessionScheduledV3 = Omit<ClassSessionScheduledPayload, 'admission' | 'contentLabel'>
type ClassSessionScheduledV4 = Omit<ClassSessionScheduledPayload, 'contentLabel'>

export function upcastClassSessionScheduled(
  payload: Record<string, unknown>,
  version: number,
): ClassSessionScheduledPayload {
  if (version >= 5) return payload as unknown as ClassSessionScheduledPayload

  //   v4 → v5: the third kind again — a v4 session had no content label because the idea did not
  //     exist, so its service name was the whole answer. `null` states that; it does not guess.
  if (version === 4) {
    return { ...(payload as unknown as ClassSessionScheduledV4), contentLabel: null }
  }

  if (version === 3) {
    const v3 = payload as unknown as ClassSessionScheduledV3
    return { ...v3, admission: defaultAdmission(v3.category), contentLabel: null }
  }

  const withAssignment: ClassSessionScheduledV2 =
    version >= 2
      ? (payload as unknown as ClassSessionScheduledV2)
      : { ...(payload as unknown as ClassSessionScheduledV1), assignedMemberId: null }

  return {
    ...withAssignment,
    cancellationWindowHours: null, // not recorded by v1/v2 — and not inventable
    cancellationWindowSource: null,
    admission: defaultAdmission(withAssignment.category),
    contentLabel: null,
  }
}
