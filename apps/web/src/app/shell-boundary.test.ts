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

// ── What only the STUDIO may see (owner, 2026-07-28) ────────────────────────────────────────
//
// The subscriptions panel shows "7/7 kredi (normalde 8)" when a package was deliberately entered
// with fewer credits than the catalogue defines — which reception does correctly and often, because
// a member migrating from the old system had already used one of hers.
//
// That parenthesis is for the DESK. To a member it reads as a package she was short-changed on, and
// she has no way to know it was her own history that shortened it. Owner: "bu normalde 8'i üye
// görmesin sakın."
//
// Today it is structurally impossible: the string lives in one staff-only component, and the member
// API returns the credits SHE was granted, never the catalogue's number. This test is what keeps it
// impossible — a copy-paste into the portal or the mobile app fails here rather than in front of a
// customer, which is the same lesson DEBT-015 taught above.
describe('the catalogue standard never reaches a member', () => {
  const MEMBER_SURFACES = [
    join(process.cwd(), 'apps/web/src/app/portal'),
    join(process.cwd(), 'apps/mobile/app'),
    join(process.cwd(), 'apps/mobile/src'),
  ]

  it('no member-facing file mentions the "normalde N" hint', () => {
    for (const root of MEMBER_SURFACES) {
      let files: string[] = []
      try {
        files = tsxFilesUnder(root)
      } catch {
        continue // the surface may not exist in every checkout
      }
      for (const f of files) {
        expect(readFileSync(f, 'utf8'), `${relative(process.cwd(), f)} üyeye katalog standardını gösteriyor`).not.toMatch(
          /normalde \$?\{?std/,
        )
      }
    }
  })

  it('the member subscriptions API returns her OWN granted credits, not the product\'s', () => {
    const api = readFileSync(join(process.cwd(), 'apps/web/src/server/member-api.ts'), 'utf8')
    const block = api.slice(api.indexOf('export async function memberSubscriptions'))
    const body = block.slice(0, block.indexOf('\nexport '))
    // `granted` is the ledger's own number — what this member was given. A catalogue lookup here
    // (products, creditCount) would be the standard leaking into her app.
    expect(body).toContain('e.credits.granted')
    expect(body).not.toMatch(/creditCount|listProducts|standardCredits/)
  })
})
