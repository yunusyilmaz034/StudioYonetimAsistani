// Ad → conversation → phone → member → payments (IG-4a, 2026-11-03) — PURE.
//
// The owner's question is not "how many clicks" but "what did this money bring". So a campaign is
// credited with:
//   · messages — conversations that STARTED from one of its ads (Meta's referral, captured by the
//     webhooks) inside the period;
//   · leads    — those conversations where we have her phone (WhatsApp always; Instagram once she wrote it);
//   · members  — leads whose phone belongs to a member who JOINED after she wrote (a member who was
//     already ours and clicked an ad is not a sale the ad made) and within the window;
//   · revenue  — those members' payments (not voided, cash basis: `receivedAt`) within the window.
//
// THE WINDOW (owner, 2026-11-03): 90 days from her first ad-referred message. Without it, a renewal two
// years later would still be booked to an old ad and make it look better than it was.
//
// Money stays integer kuruş (#10); only the two display ratios are fractional.

export const ATTRIBUTION_WINDOW_MS = 90 * 86_400_000
const DAY_SLACK_MS = 86_400_000 // she wrote in the evening, the desk registered her that morning: same day

export interface AdsDay {
  readonly spendKurus: number
  readonly impressions: number
  readonly clicks: number
  readonly messages: number
}
export interface AdsCampaign {
  readonly id: string
  readonly name: string
  readonly status: string
  readonly adIds: readonly string[]
  readonly days: Readonly<Record<string, AdsDay>>
}
export interface AttributedConversation {
  readonly adId: string
  readonly at: number
  readonly phone: string | null // digits-only normalized phone, or null (Instagram before she wrote one)
}
export interface MemberFact {
  readonly id: string
  readonly joinedAt: number
}
export interface PaymentFact {
  readonly receivedAt: number
  readonly amountKurus: number
  readonly voided: boolean
}

export interface CampaignResult {
  readonly id: string
  readonly name: string
  readonly status: string
  readonly spendKurus: number
  readonly metaMessages: number
  readonly messages: number
  readonly leads: number
  readonly members: number
  readonly revenueKurus: number
  readonly costPerMemberKurus: number | null // null when no member yet
  readonly revenuePerLira: number | null // revenue ÷ spend, null when nothing was spent
}

export interface AdsReport {
  readonly totals: Omit<CampaignResult, 'id' | 'name' | 'status'>
  readonly campaigns: readonly CampaignResult[]
}

const UNKNOWN = { id: '_unknown', name: 'Bilinmeyen reklam', status: 'UNKNOWN' } as const

/** 'YYYY-MM-DD' of `t` in Europe/Istanbul (UTC+3). */
export function istDay(t: number): string {
  return new Date(t + 3 * 3_600_000).toISOString().slice(0, 10)
}

export function attribute(input: {
  readonly from: number
  readonly to: number
  readonly campaigns: readonly AdsCampaign[]
  readonly conversations: readonly AttributedConversation[]
  readonly memberByPhone: ReadonlyMap<string, MemberFact>
  readonly paymentsByMember: ReadonlyMap<string, readonly PaymentFact[]>
}): AdsReport {
  const fromDay = istDay(input.from)
  const toDay = istDay(input.to)
  const campaignOfAd = new Map<string, string>()
  for (const c of input.campaigns) for (const a of c.adIds) campaignOfAd.set(a, c.id)

  type Acc = { id: string; name: string; status: string; spendKurus: number; metaMessages: number; messages: number; leads: number; members: number; revenueKurus: number }
  const acc = new Map<string, Acc>()
  const get = (id: string, name: string, status: string) => {
    let a = acc.get(id)
    if (!a) {
      a = { id, name, status, spendKurus: 0, metaMessages: 0, messages: 0, leads: 0, members: 0, revenueKurus: 0 }
      acc.set(id, a)
    }
    return a
  }

  for (const c of input.campaigns) {
    const a = get(c.id, c.name, c.status)
    for (const [day, d] of Object.entries(c.days)) {
      if (day < fromDay || day > toDay) continue
      a.spendKurus += d.spendKurus
      a.metaMessages += d.messages
    }
  }

  // One person counts once per campaign even if she wrote on both channels: the phone is the person.
  const seenMember = new Set<string>()
  for (const conv of input.conversations) {
    if (conv.at < input.from || conv.at > input.to) continue
    const cid = campaignOfAd.get(conv.adId)
    const a = cid ? acc.get(cid)! : get(UNKNOWN.id, UNKNOWN.name, UNKNOWN.status)
    a.messages++
    if (!conv.phone) continue
    a.leads++
    const m = input.memberByPhone.get(conv.phone)
    if (!m) continue
    const end = conv.at + ATTRIBUTION_WINDOW_MS
    if (m.joinedAt < conv.at - DAY_SLACK_MS || m.joinedAt > end) continue
    const key = `${a.id}:${m.id}`
    if (seenMember.has(key)) continue
    seenMember.add(key)
    a.members++
    for (const p of input.paymentsByMember.get(m.id) ?? []) {
      if (p.voided || p.receivedAt < conv.at - DAY_SLACK_MS || p.receivedAt > end) continue
      a.revenueKurus += p.amountKurus
    }
  }

  const finish = (a: Omit<Acc, 'id' | 'name' | 'status'>) => ({
    ...a,
    costPerMemberKurus: a.members > 0 ? Math.round(a.spendKurus / a.members) : null,
    revenuePerLira: a.spendKurus > 0 ? Math.round((a.revenueKurus / a.spendKurus) * 10) / 10 : null,
  })
  const campaigns = [...acc.values()]
    .filter((a) => a.spendKurus > 0 || a.messages > 0)
    .map((a) => ({ id: a.id, name: a.name, status: a.status, ...finish(a) }))
    .sort((x, y) => y.spendKurus - x.spendKurus)
  const sum = (k: 'spendKurus' | 'metaMessages' | 'messages' | 'leads' | 'members' | 'revenueKurus') => campaigns.reduce((n, c) => n + c[k], 0)
  return {
    totals: finish({ spendKurus: sum('spendKurus'), metaMessages: sum('metaMessages'), messages: sum('messages'), leads: sum('leads'), members: sum('members'), revenueKurus: sum('revenueKurus') }),
    campaigns,
  }
}
