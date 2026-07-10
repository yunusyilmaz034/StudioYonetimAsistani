import { defineConfig } from 'vitest/config'

// Integration tests hit the Firebase Emulator Suite and are run via
// `firebase emulators:exec` (see the `test:integration` script). They are kept out
// of the unit config (and out of `pnpm check`) because they require a running
// emulator (a JVM).
export default defineConfig({
  test: {
    globals: true,
    include: ['apps/functions/test/**/*.test.ts'],
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
})
