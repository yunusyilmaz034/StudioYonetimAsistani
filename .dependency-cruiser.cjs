// dependency-cruiser — encodes Doc 5 §5 (the module dependency graph) and §7.
// The rules exist from the first commit so the constraint is enforced before the
// modules they govern exist. A rule that matches nothing today is not dead; it is
// a guardrail waiting for the code it guards.
/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'domain-is-pure',
      comment:
        'Decision functions are pure (Doc 1 §6, Doc 5 §7). No framework, no I/O, no firebase-admin inside modules/*/domain.',
      severity: 'error',
      from: { path: 'packages/core/src/modules/[^/]+/domain' },
      to: { path: '(firebase-admin|firebase-functions|next|react|zod)' },
    },
    {
      name: 'no-deep-module-imports',
      comment:
        "A module's only public door is its index.ts (AD-29). No reaching into another module's domain/application/infrastructure.",
      severity: 'error',
      from: { path: 'packages/core/src/modules/([^/]+)' },
      to: {
        path: 'packages/core/src/modules/(?!$1)[^/]+/(domain|application|infrastructure)',
      },
    },
    {
      name: 'projections-read-events-only',
      comment:
        'A projector folds EVENTS and nothing else (AD-31). It may not import another business ' +
        'module, because the moment it reads state its numbers can no longer be rebuilt from the ' +
        'log — and a projection you cannot rebuild is not a cache, it is a second source of truth. ' +
        'v1.23: the rule now excludes the module’s own files, which the original regex caught.',
      severity: 'error',
      from: { path: 'packages/core/src/modules/projections' },
      to: {
        path: 'packages/core/src/modules/(?!events|shared)',
        pathNot: 'packages/core/src/modules/projections',
      },
    },
    {
      name: 'shared-imports-nothing',
      comment: 'The shared kernel imports nobody (Doc 5 §5).',
      severity: 'error',
      from: { path: 'packages/core/src/shared' },
      to: { path: 'packages/core/src/modules' },
    },
    {
      name: 'no-firestore-outside-infrastructure',
      comment:
        'firebase-admin lives only in infrastructure, apps/functions, or apps/web server code (Doc 3 §8, Doc 5 §7).',
      severity: 'error',
      from: { pathNot: '(infrastructure|apps/functions|apps/web/src/server)' },
      to: { path: 'firebase-admin' },
    },
    {
      name: 'no-cycles',
      comment: 'When the graph wants a cycle, the answer is an event, not an import (Doc 5 §5).',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-orphans',
      comment: 'An unreferenced module is either dead code or a missing wire-up.',
      severity: 'warn',
      from: {
        orphan: true,
        pathNot: [
          '(^|/)\\.[^/]+\\.(js|cjs|mjs|ts)$', // dotfiles like .dependency-cruiser.cjs
          '\\.config\\.(js|cjs|mjs|ts)$', // next.config, postcss.config, etc.
          '\\.d\\.ts$',
          '(^|/)(index|types)\\.ts$',
          'apps/functions/build.mjs', // the build script itself — it PRODUCES the graph, it is not in it
          'apps/web/src/app/', // Next.js App Router: framework entrypoints, found by convention
          'apps/web/src/components/ui/', // design-system foundations: exist ahead of their consumers (Doc 09 §10)
          'packages/core/src/client.ts', // the @studio/core/client wire contract — consumed by apps/mobile, which is outside depcruise's scope
        ],
      },
      to: {},
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsConfig: { fileName: 'tsconfig.json' },
    tsPreCompilationDeps: true,
    exclude: {
      path: '(node_modules|\\.next|dist|lib|coverage|test/|\\.test\\.ts$)',
    },
  },
}
