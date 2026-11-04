// IG-2c — the content-render job's bundle (src/render/main.ts → dist/main.cjs), same recipe as the
// Functions artifact (../build.mjs): the domain is bundled in, firebase-admin is installed in the image.
import path from 'node:path'

import { build } from 'esbuild'

for (const name of ['main', 'selftest']) await build({
  entryPoints: [path.resolve(import.meta.dirname, `../src/render/${name}.ts`)],
  alias: { '@studio/core': path.resolve(import.meta.dirname, '../../../packages/core/src/index.ts') },
  outfile: path.resolve(import.meta.dirname, `dist/${name}.cjs`),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  sourcemap: true,
  logLevel: 'info',
  external: ['firebase-admin', 'firebase-admin/*'],
})
