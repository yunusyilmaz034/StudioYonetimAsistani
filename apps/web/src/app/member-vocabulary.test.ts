import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

import { describe, expect, it } from 'vitest'

// OR-30 — "geç iptal" is the STUDIO's word, and a member must never meet it.
//
// On 2026-08-06 a member cancelled the same class twice inside fifty-one seconds from her phone, lost
// two credits, rang the studio and asked why. Her screen had said "Geç iptal" and warned that a
// credit would burn — and she read it as an ordinary cancellation, because from where she stands that
// is exactly what it was. The owner: *"bizde geç iptal falan diye bişey olmasın… üyeler bunu normal
// kredi iptali olarak görüyor sonra kredim niye eksildi derler."*
//
// The rule now has two halves and this test guards the second. The first is that the domain REFUSES
// a member's own cancellation inside the window (packages/core … decideCancellation, `selfService`).
// The second is vocabulary: whatever the studio calls the record internally, what a member is shown
// is "İptal edildi". Reception keeps the distinction — she needs it, and she can explain it.
//
// A static test on purpose: this is a wording fact, visible in the source, and it is the kind of
// thing a well-meaning edit reintroduces months later while every other test stays green.

const APP = join(process.cwd(), 'apps/web/src/app')
const MOBILE = join(process.cwd(), 'apps/mobile')

// Everything a member can see: the portal's route branch, and the whole phone app.
const MEMBER_SURFACES = [join(APP, 'portal'), join(MOBILE, 'app'), join(MOBILE, 'src')]

// Turkish casing is not ASCII casing — "İ" lowercases to "i̇", so a naive toLowerCase misses
// "Geç İptal". The variants are listed instead.
const FORBIDDEN = ['geç iptal', 'Geç iptal', 'Geç İptal', 'GEÇ İPTAL']

function sourceFilesUnder(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...sourceFilesUnder(full))
    else if (/\.(tsx?|jsx?)$/.test(entry)) out.push(full)
  }
  return out
}

/** A comment explaining the rule is not a violation of it — only rendered copy counts. */
function strippedOfComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n')
}

describe('OR-30 · a member never meets the words "geç iptal"', () => {
  it('does not appear in any member-facing source', () => {
    const offenders: string[] = []
    for (const root of MEMBER_SURFACES) {
      for (const file of sourceFilesUnder(root)) {
        const src = strippedOfComments(readFileSync(file, 'utf8'))
        if (FORBIDDEN.some((phrase) => src.includes(phrase))) {
          offenders.push(relative(process.cwd(), file).split(sep).join('/'))
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('is still available to the DESK, which needs the distinction', () => {
    // The guard must not have been passed by deleting the concept everywhere: reception's own panel
    // still says it, because a person at the desk has to know which kind of cancellation she is
    // looking at — and can explain it to the member in front of her.
    const desk = readFileSync(join(APP, '(staff)/schedule/booking-panel.tsx'), 'utf8')
    expect(desk).toContain('Geç iptal')
  })
})
