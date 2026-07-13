import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

// The inverted pyramid (Doc 5 §8): the top three test layers run with no
// emulator, in milliseconds. Integration tests (apps/functions) run separately
// under `firebase emulators:exec`.
export default defineConfig({
  // The web app's `@/…` alias, so a unit test can import a presenter that imports a lib.
  resolve: {
    alias: { '@': fileURLToPath(new URL('./apps/web/src', import.meta.url)) },
  },
  test: {
    globals: true,
    // Unit layer only (no emulator): the pure kernel plus the pure server-side
    // auth helpers. Emulator integration tests (apps/functions) run separately via
    // `firebase emulators:exec`.
    include: [
      'packages/core/**/*.test.ts',
      'apps/web/src/**/*.test.ts',
      // The migration's pure rules moved into `members/domain/import.ts` (v1.27 S5) — the owner's
      // import screen must run EXACTLY them, and two validators are two answers to "may this row
      // enter production?". `tools/migration` is a door now, not an implementation, and has no tests
      // of its own to run.
    ],
    passWithNoTests: true,
  },
})
