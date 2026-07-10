import { defineConfig } from 'vitest/config'

// The inverted pyramid (Doc 5 §8): the top three test layers run with no
// emulator, in milliseconds. Integration tests (apps/functions) run separately
// under `firebase emulators:exec`.
export default defineConfig({
  test: {
    globals: true,
    // Unit layer only (no emulator): the pure kernel plus the pure server-side
    // auth helpers. Emulator integration tests (apps/functions) run separately via
    // `firebase emulators:exec`.
    include: ['packages/core/**/*.test.ts', 'apps/web/src/**/*.test.ts'],
    passWithNoTests: true,
  },
})
