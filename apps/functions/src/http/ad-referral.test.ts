import { describe, expect, it } from 'vitest'

import { instagramAdId, whatsappAdId, withAdRef } from './ad-referral'

describe('whatsappAdId', () => {
  it('reads the ad id of a click-to-WhatsApp ad', () =>
    expect(whatsappAdId({ from: '905', referral: { source_type: 'ad', source_id: '120250067758990694', headline: 'x' } })).toBe('120250067758990694'))
  it('ignores a boosted POST referral and plain messages', () => {
    expect(whatsappAdId({ referral: { source_type: 'post', source_id: '120250067758990694' } })).toBeNull()
    expect(whatsappAdId({ from: '905', text: { body: 'merhaba' } })).toBeNull()
    expect(whatsappAdId(null)).toBeNull()
  })
  it('refuses an id that is not an ad id', () => expect(whatsappAdId({ referral: { source_type: 'ad', source_id: '../x' } })).toBeNull())
})

describe('instagramAdId', () => {
  it('reads messaging.referral', () => expect(instagramAdId({ referral: { source: 'ADS', ad_id: '120250000000000001', type: 'OPEN_THREAD' } })).toBe('120250000000000001'))
  it('reads message.referral', () => expect(instagramAdId({ message: { mid: 'm', referral: { ad_id: '120250000000000002' } } })).toBe('120250000000000002'))
  it('ignores a non-ad referral', () => expect(instagramAdId({ referral: { source: 'SHORTLINK', ref: 'x' } })).toBeNull())
  it('is null-safe', () => expect(instagramAdId(undefined)).toBeNull())
})

describe('withAdRef', () => {
  it('sets the first attribution', () => expect(withAdRef({}, '123456', 10, 'whatsapp')).toEqual({ adRef: { adId: '123456', at: 10, channel: 'whatsapp' } }))
  it('never overwrites it — the first ad that brought her keeps the credit', () => {
    const c = { adRef: { adId: '111111', at: 1, channel: 'whatsapp' as const } }
    expect(withAdRef(c, '222222', 2, 'whatsapp')).toBe(c)
  })
  it('no ad → no change', () => {
    const c = {}
    expect(withAdRef(c, null, 1, 'instagram')).toBe(c)
  })
})
