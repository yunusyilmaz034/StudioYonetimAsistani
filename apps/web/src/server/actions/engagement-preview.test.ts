import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

// THE PREVIEW MUST BE A PREVIEW OF *THIS* SEND (owner, 2026-08-31).
//
// "173 üyeye gönder" used to send 173 irreversible messages on one press. The owner asked to see who
// would receive what first, and approve it. That is only worth anything if the screen she approves
// is the send that then happens.
//
// Two ways it could quietly stop being true, and both are wiring, not logic:
//
//   1. The two actions resolve the audience differently — one honouring a hand-picked group, the
//      other falling back to a segment. She would approve a list that was never used.
//   2. The preview computes channel reach with its own copy of the consent rules. The pipeline's
//      copy changes, the preview's does not, and it goes on reporting numbers that were true last
//      quarter. This is the more dangerous one: nothing breaks, and the screen keeps looking right.
//
// So both are held structurally. `selectChannels` is the pure function `notify()` itself uses; the
// preview is required to call it by name rather than re-derive "who has consented".

const FILE = join(process.cwd(), 'apps/web/src/server/actions/notifications.ts')

/** The body of one exported action, from its signature to the next top-level `export`. */
function actionBody(src: string, name: string): string {
  const start = src.indexOf(`export async function ${name}(`)
  expect(start, `${name} bulunamadı`).toBeGreaterThan(-1)
  const rest = src.slice(start + 10)
  const end = rest.indexOf('\nexport ')
  return end === -1 ? rest : rest.slice(0, end)
}

describe('engagement: the preview and the send agree, by construction', () => {
  const src = readFileSync(FILE, 'utf8')
  const send = actionBody(src, 'sendEngagementAction')
  const preview = actionBody(src, 'previewEngagementAction')

  it('both resolve the audience through the SAME function', () => {
    expect(send).toContain('resolveAudience(')
    expect(preview).toContain('resolveAudience(')
  })

  it('neither reaches past it to resolve a segment on its own', () => {
    // `resolveSegment` still exists and is still correct — but a caller that reaches for it here has
    // stepped around the branch that honours a hand-picked group.
    expect(send).not.toContain('resolveSegment(')
    expect(preview).not.toContain('resolveSegment(')
  })

  it('the preview asks the PIPELINE which channels would be used', () => {
    // Not a reimplementation of "has she consented?" — the same pure function notify() calls.
    expect(preview).toContain('selectChannels(')
    expect(preview).toContain("'marketing'")
  })

  it('both apply the same per-send channel override, and both put in_app back', () => {
    // in_app is the member's own account record. A send may be narrowed to WhatsApp; it may not
    // remove the line from her history — so the preview must not promise that it would.
    for (const [name, body] of [
      ['send', send],
      ['preview', preview],
    ] as const) {
      expect(body, name).toContain("'in_app'")
      expect(body, name).toContain('enabledChannels')
    }
  })

  it('the send still accepts a hand-picked group', () => {
    expect(send).toContain('groupId')
  })
})
