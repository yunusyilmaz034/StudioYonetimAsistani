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
    // One file at a time: these suites share ONE emulator, and the rules suite wipes the
    // database between its cases. A parallel trigger test would have its fixtures deleted
    // underneath it — and would fail intermittently, which is worse than failing outright.
    fileParallelism: false,
  },
})
