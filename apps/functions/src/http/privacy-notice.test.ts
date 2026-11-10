import { describe, expect, it } from 'vitest'

import { withPrivacyNotice } from './privacy-notice'

const URL = 'https://example.test/kvkk'

describe('withPrivacyNotice', () => {
  it('adds the notice line to the first reply of a conversation', () => {
    const r = withPrivacyNotice('Merhaba!', {}, URL)
    expect(r.noticed).toBe(true)
    expect(r.text).toBe(`Merhaba!\n\nKişisel verilerinizin işlenmesi hakkında bilgi: ${URL}`)
  })

  it('never adds it twice', () => {
    const r = withPrivacyNotice('Merhaba!', { privacyNoticeAt: 1 }, URL)
    expect(r).toEqual({ text: 'Merhaba!', noticed: false })
  })

  it('adds nothing when the studio has no notice address', () => {
    expect(withPrivacyNotice('Merhaba!', {}, undefined)).toEqual({ text: 'Merhaba!', noticed: false })
    expect(withPrivacyNotice('Merhaba!', {}, '   ')).toEqual({ text: 'Merhaba!', noticed: false })
  })
})
