import { type NextRequest } from 'next/server'

import { memberInboxList, memberInboxMarkRead, withMember } from '@/server/member-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET — her inbox (the one channel she cannot switch off). POST { intentId } — mark one read.
export async function GET(req: NextRequest) {
  return withMember(req, (ctx, memberId) => memberInboxList(ctx, memberId))
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { intentId?: string }
  return withMember(req, (ctx, memberId) => {
    if (!body.intentId) return Promise.resolve({ ok: false as const, error: { code: 'intent_required' } })
    return memberInboxMarkRead(ctx, memberId, body.intentId)
  })
}
