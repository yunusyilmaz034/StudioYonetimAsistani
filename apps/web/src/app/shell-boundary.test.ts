import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

import { describe, expect, it } from 'vitest'

// DEBT-015 — the shell boundary, asserted.
//
// In v1.21 the member portal rendered inside the STAFF shell for a whole batch: a customer saw the
// owner's sidebar — every screen of the business she is a customer of. `pnpm check` was green the
// entire time. Typecheck cannot see it, lint cannot see it, and no unit test was looking; it was
// caught by the owner glancing at a screenshot.
//
// Today's guarantee is structural — the staff shell is imported by exactly ONE layout, and the
// portal lives in a different branch of the route tree — which is strong, and completely untested.
// This is the test. It is deliberately a STATIC one: a shell leak is a wiring fact, visible in the
// import graph, and a rendering test would need a server to tell us something the source already
// says out loud.

const APP = join(process.cwd(), 'apps/web/src/app')
const SHELL = 'AppShell'

function tsxFilesUnder(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...tsxFilesUnder(full))
    else if (entry.endsWith('.tsx') || entry.endsWith('.ts')) out.push(full)
  }
  return out
}

/** Files that IMPORT the staff shell — a comment mentioning it does not count. */
function importersOfTheShell(): string[] {
  return tsxFilesUnder(APP)
    .filter((file) => {
      const src = readFileSync(file, 'utf8')
      return src.split('\n').some((line) => line.startsWith('import') && line.includes(SHELL))
    })
    .map((file) => relative(APP, file).split(sep).join('/'))
}

describe('the staff shell never reaches a member', () => {
  it('is imported by exactly one layout, and it is the staff one', () => {
    // If this fails with a SECOND importer, do not add it to the list. A shell with two doors is
    // a shell that will eventually open the wrong one.
    expect(importersOfTheShell()).toEqual(['(staff)/layout.tsx'])
  })

  it('is imported by nothing under /portal — her branch of the tree cannot reach it', () => {
    const leaks = importersOfTheShell().filter((f) => f.startsWith('portal/'))
    expect(leaks, 'the member portal is importing the owner navigation').toEqual([])
  })

  it('is not imported by the ROOT layout, which wraps her too', () => {
    // The original defect exactly: the shell sat in `app/layout.tsx`, so every route on the
    // domain — the member's included — was wrapped in the owner's sidebar.
    expect(importersOfTheShell()).not.toContain('layout.tsx')
  })
})
