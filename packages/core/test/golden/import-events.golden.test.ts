import { describe, expect, it } from 'vitest'

import type { ImportAppliedPayload, ImportRevertedPayload } from '../../src/modules/imports/events'
import applied from './import.applied.v1.json'
import reverted from './import.reverted.v1.json'

// The contract these fixtures lock is not the field list — it is what the field list may never
// contain. An import handles the studio's entire member roster, so it is the single easiest place
// in this system to spill a hundred names and phone numbers into the append-only log, where they
// can never be erased (#6, I-13). Who was imported is already recorded, once, by the
// `member.registered` events the batch writes; a second copy here would answer nothing and would
// double the work of a KVKK erasure request for ever.

describe('import event payloads', () => {
  it('import.applied matches its type', () => {
    const payload: ImportAppliedPayload = applied
    expect(payload).toEqual({
      batchId: 'imp_01KYQ3KS899AZ0N6P4AH0GZH3Y',
      kind: 'members',
      rowCount: 74,
      createdMembers: 71,
      createdEntitlements: 0,
      skipped: 3,
    })
  })

  it('import.reverted matches its type, and keeps the reason', () => {
    const payload: ImportRevertedPayload = reverted
    expect(payload.reason).toBe('Yanlış dosya aktarıldı')
    expect(payload).toEqual({
      batchId: 'imp_01KYQ3KS899AZ0N6P4AH0GZH3Y',
      reason: 'Yanlış dosya aktarıldı',
      revertedMembers: 71,
      revertedEntitlements: 0,
    })
  })

  it('carries NO personal data — the roster never enters the log twice', () => {
    const text = JSON.stringify([applied, reverted]).toLowerCase()
    for (const forbidden of ['name', 'isim', 'phone', 'telefon', 'mail', 'birth', 'dogum', '@', '+90', '05']) {
      expect(text, `import payload leaks ${forbidden}`).not.toContain(forbidden)
    }
  })

  it('counts are numbers, so a screen can add them without parsing', () => {
    for (const k of ['rowCount', 'createdMembers', 'createdEntitlements', 'skipped'] as const) {
      expect(typeof applied[k]).toBe('number')
    }
  })
})
