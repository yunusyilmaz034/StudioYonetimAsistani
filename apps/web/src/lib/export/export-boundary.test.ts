import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

import { describe, expect, it } from 'vitest'

import { canSee, PERMISSIONS, type Area } from '../permissions'

// **Bulk export is the owner's alone** (owner, 2026-07-13).
//
// A CSV of the members list is the whole studio's PII in one file, on a laptop, in a Downloads
// folder, forever. It is the single easiest way for the studio's data to leave the studio — no
// breach, no attacker, just a well-meaning person and a button. So the button belongs to exactly one
// person.
//
// Today that is TRUE BY ACCIDENT: `downloadCsv` happens to be imported only by screens that live in
// owner-only areas. This test turns the accident into a RULE. It is deliberately structural — a
// leaked export is a wiring fact, plainly visible in the import graph, and the import graph is where
// it should be caught, not in a code review three months from now.

const APP = join(process.cwd(), 'apps/web/src/app')

function sourceFilesUnder(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...sourceFilesUnder(full))
    else if (entry.endsWith('.tsx') || entry.endsWith('.ts')) out.push(full)
  }
  return out
}

/** Every file under `app/` that imports the CSV writer, as a route-relative path. */
function exporters(): string[] {
  return sourceFilesUnder(APP)
    .filter((file) => {
      const src = readFileSync(file, 'utf8')
      return src
        .split('\n')
        .some((line) => line.startsWith('import') && line.includes('lib/export/csv'))
    })
    .map((file) => relative(APP, file).split(sep).join('/'))
}

/**
 * Which permission area does a file under `app/(staff)/…` belong to?
 *
 * The route group `(staff)` is not a path segment, and a screen lives in the area of its top-level
 * route — `insights/[id]/insight-screen.tsx` is analysis, and is gated as analysis.
 */
function areaOf(file: string): Area | null {
  const route = file.replace(/^\(staff\)\//, '').split('/')[0]
  const candidate = `/${route}` as Area
  if (candidate in PERMISSIONS) return candidate
  // `/insights` has no row of its own: it is the dashboard's drill-down, and it is gated as analysis.
  if (candidate === ('/insights' as Area)) return '/analytics'
  return null
}

describe('bulk export belongs to the owner, and to nobody else', () => {
  it('is reachable ONLY from owner-only screens', () => {
    const leaks = exporters().filter((file) => {
      const area = areaOf(file)
      // A file we cannot place is a failure, not a pass. An export button in a screen with no
      // permission area is an export button with no lock.
      if (!area) return true
      return canSee('receptionist', area) || canSee('trainer', area)
    })

    expect(
      leaks,
      'a non-owner screen can download a CSV — the studio’s data in one file, on a laptop, forever',
    ).toEqual([])
  })

  it('is imported by at least one screen — otherwise this test is guarding nothing', () => {
    // A structural test that passes because the thing it guards no longer exists is a test that
    // will keep passing while the rule quietly stops being enforced anywhere.
    expect(exporters().length).toBeGreaterThan(0)
  })
})
