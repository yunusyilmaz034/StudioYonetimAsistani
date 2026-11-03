import { describe, expect, it } from 'vitest'

import { convLabel } from './conv-label'

const base = { name: '', handle: '', phone: '', channel: 'instagram' as const }

describe('convLabel', () => {
  it('prefers the name she gave', () => expect(convLabel({ ...base, name: 'Aslı T.', handle: 'asli' })).toBe('Aslı T.'))
  it('falls back to the @username', () => expect(convLabel({ ...base, handle: 'elif.kaya' })).toBe('@elif.kaya'))
  it('then to the phone tail', () => expect(convLabel({ ...base, phone: '905321234567' })).toBe('234567'))
  it('never shows the raw Instagram id', () => expect(convLabel(base)).toBe('Instagram kişisi'))
  it('keeps the WhatsApp behaviour (phone tail)', () =>
    expect(convLabel({ ...base, channel: 'whatsapp', phone: '905321234567' }, 4)).toBe('4567'))
})
