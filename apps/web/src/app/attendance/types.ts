import type { AttendanceOutcome } from '@studio/core'

// Optimistic attendance marks, keyed by reservationId. A mark is applied on tap for
// instant feedback (UX-9) while the /commands write and its trigger settle; the
// effective status of a roster entry is `marks[id] ?? entry.status`. Shared by the
// screen and the roster sheet, so it lives here to keep those two acyclic.
export type Mark = AttendanceOutcome
export type Marks = Record<string, Mark>
