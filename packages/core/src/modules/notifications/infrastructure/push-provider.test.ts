import { describe, expect, it } from 'vitest'
import type { Firestore } from 'firebase-admin/firestore'

import { PUSH_BODY, PUSH_TITLE, PushProvider } from './providers'

// KVKK (owner, 2026-11-10): the push service is abroad and would not sign the KVKK standard contract,
// so a push carries no personal data. The message itself lives in her in-app inbox.
describe('PushProvider — nothing personal leaves in a push', () => {
  it('sends the generic title and body, never the rendered subject/body', async () => {
    const devices = { docs: [{ get: (f: string) => (f === 'token' ? 'ExponentPushToken[abc]' : undefined) }] }
    const chain: Record<string, unknown> = {}
    chain.collection = () => chain
    chain.doc = () => chain
    chain.get = async () => devices
    const db = chain as unknown as Firestore

    let sent: unknown = null
    const f = (async (_url: string, init?: RequestInit) => {
      sent = JSON.parse(String(init!.body))
      return new Response(JSON.stringify({ data: [{ status: 'ok' }] }), { status: 200 })
    }) as unknown as typeof fetch

    const r = await new PushProvider(db, f).send({ studioId: 'retro' } as never, {
      intentId: 'int_1',
      to: { memberId: 'mem_1' },
      subject: 'Ayşe, yarın 18:30 Reformer',
      body: 'Bugün yaklaşık 1.850 kcal yaktın',
    } as never)

    expect(r.ok).toBe(true)
    expect(sent).toEqual([{ to: 'ExponentPushToken[abc]', title: PUSH_TITLE, body: PUSH_BODY, data: { intentId: 'int_1' } }])
    expect(JSON.stringify(sent)).not.toMatch(/Ayşe|kcal|18:30/)
  })
})
