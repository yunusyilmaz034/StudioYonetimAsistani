import { createHmac } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { extractPhone, instagramAction, parseInstagramWebhook, verifyMetaSignature } from './instagram-parse'

const OUR_IG = '17841458516080649'
const body = (messaging: unknown[]) => ({ object: 'instagram', entry: [{ id: OUR_IG, time: 1, messaging }] })

describe('parseInstagramWebhook', () => {
  it('reads a customer text message', () => {
    const out = parseInstagramWebhook(
      body([{ sender: { id: 'C1' }, recipient: { id: OUR_IG }, timestamp: 1000, message: { mid: 'm1', text: 'Reformer fiyatı?' } }]),
    )
    expect(out).toEqual([{ kind: 'message', igsid: 'C1', mid: 'm1', text: 'Reformer fiyatı?', hasAttachment: false, at: 1000, adId: null }])
  })

  it('marks a photo as an attachment with no text', () => {
    const [m] = parseInstagramWebhook(
      body([{ sender: { id: 'C1' }, timestamp: 5, message: { mid: 'm2', attachments: [{ type: 'image' }] } }]),
    )
    expect(m).toMatchObject({ kind: 'message', text: null, hasAttachment: true })
  })

  it('turns our own message into an ECHO addressed to the customer (recipient), not from her', () => {
    const [m] = parseInstagramWebhook(
      body([{ sender: { id: OUR_IG }, recipient: { id: 'C1' }, timestamp: 7, message: { mid: 'm3', text: 'Merhaba', is_echo: true } }]),
    )
    expect(m).toEqual({ kind: 'echo', igsid: 'C1', mid: 'm3', text: 'Merhaba', at: 7 })
  })

  it('ignores deletions, read receipts, empty texts and other objects', () => {
    expect(parseInstagramWebhook(body([{ sender: { id: 'C1' }, message: { mid: 'm4', is_deleted: true } }]))).toEqual([])
    expect(parseInstagramWebhook(body([{ sender: { id: 'C1' }, read: { mid: 'm1' } }]))).toEqual([])
    expect(parseInstagramWebhook(body([{ sender: { id: 'C1' }, message: { mid: 'm5', text: '   ' } }]))).toEqual([])
    expect(parseInstagramWebhook({ object: 'whatsapp_business_account', entry: [] })).toEqual([])
    expect(parseInstagramWebhook(null)).toEqual([])
  })
})

describe('parseInstagramWebhook — ad referral (IG-4a)', () => {
  it('carries the ad id of a click-to-Instagram-DM ad', () => {
    const [m] = parseInstagramWebhook(
      body([{ sender: { id: 'C1' }, timestamp: 9, referral: { source: 'ADS', ad_id: '120250000000000001' }, message: { mid: 'm9', text: 'Bilgi alabilir miyim' } }]),
    )
    expect(m).toMatchObject({ kind: 'message', adId: '120250000000000001' })
  })
})

describe('verifyMetaSignature', () => {
  const secret = 'app-secret'
  const raw = Buffer.from(JSON.stringify(body([])))
  const good = `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`

  it('accepts Meta’s signature', () => expect(verifyMetaSignature(raw, good, secret)).toBe(true))
  it('refuses a body that was changed', () => expect(verifyMetaSignature(Buffer.from('{}'), good, secret)).toBe(false))
  it('refuses a missing or malformed header', () => {
    expect(verifyMetaSignature(raw, undefined, secret)).toBe(false)
    expect(verifyMetaSignature(raw, 'sha1=abc', secret)).toBe(false)
    expect(verifyMetaSignature(raw, 'sha256=zz', secret)).toBe(false)
  })
  it('refuses when no secret is configured — never a silent pass', () => expect(verifyMetaSignature(raw, good, '')).toBe(false))
})

describe('extractPhone', () => {
  it.each([
    ['numaram 0532 123 45 67 arar mısınız', '905321234567'],
    ['+90 (532) 1234567', '905321234567'],
    ['5321234567', '905321234567'],
    ['0532-123-45-67', '905321234567'],
  ])('finds %s', (text, want) => expect(extractPhone(text)).toBe(want))

  it.each([
    ['fiyat 3200 TL'],
    ['0212 123 45 67'], // landline — AD-40 rejects it in the import too
    ['saat 18:30'],
    [''],
  ])('finds nothing in %s', (text) => expect(extractPhone(text)).toBeNull())

  it('is null-safe', () => expect(extractPhone(null)).toBeNull())
})

describe('instagramAction — the mode guarantee', () => {
  const ready = { humanHolds: false, aiReady: true, readable: true, canSend: true }

  it('off (and absent) only stores', () => {
    expect(instagramAction({ ...ready, mode: 'off' })).toBe('store')
    expect(instagramAction({ ...ready, mode: undefined })).toBe('store')
  })
  it('draft NEVER sends, even with every credential present', () => expect(instagramAction({ ...ready, mode: 'draft' })).toBe('draft'))
  it('auto sends', () => expect(instagramAction({ ...ready, mode: 'auto' })).toBe('send'))
  it('auto without Meta credentials degrades to a draft, not to silence', () =>
    expect(instagramAction({ ...ready, mode: 'auto', canSend: false })).toBe('draft'))
  it.each([
    ['a human holds the conversation', { humanHolds: true }],
    ['the AI is not configured', { aiReady: false }],
    ['she sent a photo the model cannot read', { readable: false }],
  ])('only stores when %s', (_why, patch) => {
    expect(instagramAction({ ...ready, mode: 'auto', ...patch })).toBe('store')
    expect(instagramAction({ ...ready, mode: 'draft', ...patch })).toBe('store')
  })
})
