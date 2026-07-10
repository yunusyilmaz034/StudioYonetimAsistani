import { describe, expect, it } from 'vitest'

// A single smoke test. It proves the test harness is wired end to end — vitest
// resolves, TypeScript compiles, the runner reports — with no business logic and
// no emulator. The real domain suites (credit ledger, freeze arithmetic, the 21
// invariants, golden fixtures) replace it in the next milestone.
describe('scaffold', () => {
  it('runs the unit-test harness', () => {
    expect(true).toBe(true)
  })
})
