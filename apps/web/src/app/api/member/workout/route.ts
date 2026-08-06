import { type NextRequest } from 'next/server'

import { completeOwnWorkoutDay, myWorkoutProgress } from '@/server/actions/training'
import { withMember } from '@/server/member-api'

// The member's own workout log: where she is in the programme cycle (GET), and marking a day done
// (POST). Not a check-in — nothing written here counts towards attendance.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const programId = new URL(req.url).searchParams.get('programId') ?? ''
  return withMember(req, (ctx, memberId) => myWorkoutProgress(ctx, memberId, programId))
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as unknown
  return withMember(req, (ctx, memberId) => completeOwnWorkoutDay(ctx, memberId, body))
}
