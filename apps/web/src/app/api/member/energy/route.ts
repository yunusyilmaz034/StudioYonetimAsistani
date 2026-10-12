import { type NextRequest } from 'next/server'

import { energyAction, energyState } from '@/server/energy'
import { withMember } from '@/server/member-api'

// The member's daily energy account — "bugün kaç kalori yaktın?" (owner, 2026-10-13). GET is her
// state (the wizard's prefill before she starts; her days after). POST is one action, and every
// action answers with the fresh state. Nothing here is a check-in or counts towards attendance.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// A photo of a machine's screen is read by a model before this answers.
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const days = Number(new URL(req.url).searchParams.get('days') ?? '')
  return withMember(req, (ctx, memberId) => energyState(ctx, memberId, Number.isFinite(days) && days > 0 ? days : undefined))
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as unknown
  return withMember(req, (ctx, memberId) => energyAction(ctx, memberId, body))
}
