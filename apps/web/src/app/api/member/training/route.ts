import { type NextRequest } from 'next/server'

import { loadMyTraining } from '@/server/actions/training'
import { withMember } from '@/server/member-api'

// Everything the web training screen shows: programmes, the active programme, the exercise guides for
// her programme's moves, measurements, per-exercise feedback, and shared progress photos (signed URLs).
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  return withMember(req, (ctx, memberId) => loadMyTraining(ctx, memberId))
}
