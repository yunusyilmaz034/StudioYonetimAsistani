import { instant, type Instant } from './time'

// The clock is a port. Domain code receives `now: Instant` as an argument and
// never reads the ambient clock (non-negotiable #7) — a non-deterministic
// decision function cannot be tested exhaustively. This is the one place a real
// clock is constructed, and it lives outside `domain/`.
export interface Clock {
  now(): Instant
}

export const systemClock: Clock = {
  now: () => instant(Date.now()),
}

// For tests and replay: a clock frozen at a known instant.
export const fixedClock = (at: Instant): Clock => ({
  now: () => at,
})
