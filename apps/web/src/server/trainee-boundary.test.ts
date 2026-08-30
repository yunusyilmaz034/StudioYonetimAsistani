import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

// THE TRAINER'S MEMBER SCREEN MUST STAY THIN (owner, 2026-08-30).
//
// The trainers are in the system now. The owner's rule was exact: they see a member's name, her
// training and her ACTIVE package — *"üyenin telefon geçmiş paketleri göremesin"* — and nothing from
// the studio's money at all.
//
// That boundary lives in `server/trainee-query.ts`, which reads only the fields it serves. This test
// keeps it there. The realistic regression is not malice; it is somebody six months from now adding
// a phone number to the row "so the trainer can call her about a session change" — a sentence that
// sounds reasonable in a pull request and quietly turns a training screen into a copy of the member
// list. A rule nobody can state in November is a rule that is gone by December.
//
// It is deliberately STRUCTURAL, like `lib/export/export-boundary.test.ts`: what reaches the browser
// is a wiring fact, visible in the source, and the source is where it should be caught.

const ROOTS = [
  join(process.cwd(), 'apps/web/src/server/trainee-query.ts'),
  join(process.cwd(), 'apps/web/src/app/(staff)/trainees'),
]

/**
 * Forbidden field names, with what each one would leak.
 *
 * `phone` is the studio's PII and the one field that makes a member list worth copying. The money
 * names are here because a trainer is not on the money path at all — she cannot see a price, a
 * balance or a payment, and there is no version of her job that needs one.
 */
const YASAK: readonly (readonly [RegExp, string])[] = [
  [/\bphone\b|\bphoneNormalized\b/i, 'üyenin telefonu — stüdyonun PII’si'],
  [/\bbalanceDue/i, 'bakiye — borç, eğitmenin işi değil'],
  [/\bpriceAgreed\b|\bpriceInKurus\b|\bcashPriceInKurus\b/i, 'fiyat'],
  [/\bpayment/i, 'ödeme kaydı'],
  [/\bKurus\b/, 'para (kuruş)'],
]

function sourceFilesUnder(path: string): string[] {
  if (statSync(path).isFile()) return [path]
  const out: string[] = []
  for (const entry of readdirSync(path)) {
    const full = join(path, entry)
    if (statSync(full).isDirectory()) out.push(...sourceFilesUnder(full))
    else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) out.push(full)
  }
  return out
}

/**
 * The file's CODE, with comments removed.
 *
 * The comments in these files say the words "phone" and "price" on purpose — they explain what is
 * absent and why. Explaining a rule must not trip the test that enforces it, so the prose is
 * stripped and only the code is judged. Line-oriented and unsubtle: a `//` inside a string literal
 * would over-strip, and in these files there is none.
 */
function codeOnly(src: string): string {
  return (
    src
      // Block comments FIRST, across the whole file — `/* … */` and the JSX `{/* … */}` alike, and
      // both of them spanning as many lines as they like. Doing this line by line was the first
      // version and it was wrong: a three-line JSX comment explaining that payments are absent kept
      // only its first line stripped, and the test failed on its own prose.
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .map((line) => line.replace(/\/\/.*$/, ''))
      .join('\n')
  )
}

describe('the trainer’s member screen — what she may not see is never read', () => {
  const files = ROOTS.flatMap(sourceFilesUnder)

  it('covers the query and every screen under /trainees', () => {
    // A silent zero here would make every case below pass while proving nothing.
    expect(files.length).toBeGreaterThanOrEqual(4)
  })

  for (const [pattern, ne] of YASAK) {
    it(`hiçbir yerde ${ne} geçmez`, () => {
      const suclu = files.filter((f) => pattern.test(codeOnly(readFileSync(f, 'utf8'))))
      expect(suclu, `${ne} sızdı: ${suclu.join(', ')}`).toEqual([])
    })
  }

  it('serves only the packages that are ACTIVE — the history is reception’s record, not a lesson plan', () => {
    const src = codeOnly(readFileSync(ROOTS[0]!, 'utf8'))
    expect(src).toContain("e.status !== 'active'")
  })

  it('does not serve erased members — a KVKK tombstone is not somebody a lesson is planned for', () => {
    const src = codeOnly(readFileSync(ROOTS[0]!, 'utf8'))
    expect(src).toContain("'deleted'")
  })
})
