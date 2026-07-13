// The Functions deploy artifact.
//
// `tsc` alone cannot produce one. This is a pnpm workspace: `@studio/core` is a
// symlink that `firebase deploy` never uploads, and `moduleResolution: Bundler`
// emits extensionless imports that Node's loader refuses. A `tsc` build is therefore
// typecheck output, not something Node can run — which is exactly why no Cloud
// Function in this repository had ever loaded (DEBT-011).
//
// esbuild bundles the domain INTO the artifact: one file, no workspace links, every
// import resolved at build time. Only the two packages the Functions runtime installs
// for itself stay external — they are real `dependencies` in package.json, and GCP
// installs them from the registry.
//
// CJS, not ESM: firebase-admin and firebase-functions ship CommonJS, and ESM→CJS
// named-import interop is the most fragile seam in Node. Gen-2 Functions default to
// CJS; this is the combination with the fewest ways to fail at 03:00.
import { build } from 'esbuild'

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'lib/index.js',
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  sourcemap: true,
  logLevel: 'info',
  external: [
    'firebase-admin',
    'firebase-admin/*',
    'firebase-functions',
    'firebase-functions/*',
  ],
})
