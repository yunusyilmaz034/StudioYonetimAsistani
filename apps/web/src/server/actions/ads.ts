'use server'

import { FirestoreFinanceRepository, FirestoreMemberRepository, normalizePhone, type MemberId } from '@studio/core'
import { z } from 'zod'

import { attribute, type AdsCampaign, type AdsReport, type AttributedConversation, type MemberFact, type PaymentFact } from '@/lib/ads-attribution'

import { requireTenantContext } from '../auth'
import { adminDb } from '../firebase-admin'

// IG-4a — Para → Reklamlar (owner-only). READ-ONLY: the summary the nightly job pulled from Meta, joined
// with our own conversations (the ad that opened each), members and payments. Nothing here writes to
// Meta or to the studio's data.
const OWNER = ['owner', 'platform_admin'] as const
const DAY = 86_400_000

export interface AdsScreen {
  readonly configured: boolean // an ad account is set and the nightly job has run at least once
  readonly syncedAt: number | null
  readonly accountId: string | null
  readonly days: number
  readonly report: AdsReport
}

export async function adsReportAction(input: unknown): Promise<AdsScreen> {
  const p = z.object({ days: z.union([z.literal(7), z.literal(30), z.literal(90)]).default(30) }).parse(input ?? {})
  const ctx = await requireTenantContext(OWNER)
  const sid = String(ctx.studioId)
  const to = Date.now()
  const from = to - p.days * DAY

  const [summarySnap, convSnap] = await Promise.all([
    adminDb().doc(`studios/${sid}/adsInsights/summary`).get(),
    // Only conversations an ad opened. `adRef.at` is set once, at the first referred message.
    adminDb().collection(`studios/${sid}/conversations`).where('adRef.at', '>=', from).get(),
  ])
  const summary = summarySnap.data() as { campaigns?: AdsCampaign[]; syncedAt?: number; accountId?: string } | undefined

  const conversations: AttributedConversation[] = []
  for (const d of convSnap.docs) {
    const c = d.data() as { adRef?: { adId?: string; at?: number }; phone?: string; channel?: string }
    if (!c.adRef?.adId || typeof c.adRef.at !== 'number') continue
    const raw = String(c.phone || (c.channel === 'instagram' ? '' : d.id))
    const n = raw ? normalizePhone(raw) : null
    conversations.push({ adId: c.adRef.adId, at: c.adRef.at, phone: n && n.ok ? n.value.normalized : null })
  }

  // Members and payments for the phones the ads brought — bounded by the number of ad leads, not the
  // size of the studio.
  const members = new FirestoreMemberRepository(adminDb())
  const finance = new FirestoreFinanceRepository(adminDb())
  const memberByPhone = new Map<string, MemberFact>()
  const paymentsByMember = new Map<string, PaymentFact[]>()
  for (const phone of new Set(conversations.map((c) => c.phone).filter((x): x is string => Boolean(x)))) {
    const m = await members.findByPhone(ctx, phone)
    if (!m || m.status === 'deleted') continue
    memberByPhone.set(phone, { id: String(m.id), joinedAt: Number(m.joinedAt) })
    const pays = await finance.listPaymentsByMember(ctx, m.id as MemberId)
    paymentsByMember.set(
      String(m.id),
      pays.map((x) => ({ receivedAt: Number(x.receivedAt), amountKurus: Number(x.amount.amount), voided: Boolean(x.voided) })),
    )
  }

  const report = attribute({ from, to, campaigns: summary?.campaigns ?? [], conversations, memberByPhone, paymentsByMember })
  return {
    configured: Boolean(summary),
    syncedAt: summary?.syncedAt ?? null,
    accountId: summary?.accountId ?? null,
    days: p.days,
    report,
  }
}
