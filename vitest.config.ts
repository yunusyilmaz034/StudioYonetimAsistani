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
      // The migration's PURE rules — what it accepts, what it refuses, what it never merges.
      // AD-36 says the migration never *runs* in CI, and it does not: nothing here touches
      // Firestore. But it is the one script whose mistakes are unrecoverable, and an untested
      // validator is the last place to save an afternoon.
      'tools/migration/**/*.test.ts',
    ],
    passWithNoTests: true,
  },
})
