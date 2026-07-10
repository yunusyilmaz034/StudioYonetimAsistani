import { defineConfig } from 'vitest/config'

// The inverted pyramid (Doc 5 §8): the top three test layers run with no
// emulator, in milliseconds. Integration tests (apps/functions) run separately
// under `firebase emulators:exec`.
export default defineConfig({
  test: {
    globals: true,
    include: ['packages/core/**/*.test.ts', 'packages/core/**/*.spec.ts'],
    passWithNoTests: true,
  },
})
