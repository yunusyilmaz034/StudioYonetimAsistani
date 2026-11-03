// Which AD started this conversation? (IG-4a, 2026-11-03) — PURE.
//
// Meta attaches a `referral` to the first message of a conversation opened from a click-to-message ad.
// We keep ONE thing from it: the ad id. With it, the conversation → its phone → the member → her payments
// can be traced back to the ad that paid for her ("üye başı maliyet"). The ad's headline/body and the
// click id are not kept — the ad id is enough to join with the insights we pull from the ad account.
//
//   WhatsApp: messages[i].referral = { source_type: 'ad' | 'post', source_id, source_url, headline, ctwa_clid… }
//   Instagram: messaging[i].referral (or messaging[i].message.referral) = { source: 'ADS', ad_id, type… }
//
// The FIRST referral wins (`adRef` is set once): a second ad click later in the same conversation does
// not re-attribute the person — she was already ours when she clicked the second one.

export interface AdRef {
  readonly adId: string
  readonly at: number // ms — when the referred message arrived
  readonly channel: 'whatsapp' | 'instagram'
}

const AD_ID = /^\d{5,30}$/

export function whatsappAdId(message: unknown): string | null {
  const r = (message as { referral?: { source_type?: unknown; source_id?: unknown } } | null)?.referral
  if (!r || r.source_type !== 'ad') return null
  const id = String(r.source_id ?? '')
  return AD_ID.test(id) ? id : null
}

export function instagramAdId(messaging: unknown): string | null {
  const m = messaging as { referral?: Ref; message?: { referral?: Ref } } | null
  for (const r of [m?.referral, m?.message?.referral]) {
    if (!r) continue
    if (r.source != null && String(r.source).toUpperCase() !== 'ADS') continue
    const id = String(r.ad_id ?? '')
    if (AD_ID.test(id)) return id
  }
  return null
}
interface Ref {
  source?: unknown
  ad_id?: unknown
}

/** Keep the first attribution; never overwrite it. */
export function withAdRef<T extends { adRef?: AdRef | null }>(conv: T, adId: string | null, at: number, channel: AdRef['channel']): T {
  if (!adId || conv.adRef) return conv
  return { ...conv, adRef: { adId, at, channel } }
}
