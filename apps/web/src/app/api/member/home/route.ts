import { type NextRequest } from 'next/server'

import { memberHomeExtras, withMember } from '@/server/member-api'

// Home-screen extras: the anonymous studio occupancy LEVEL (never a headcount — §11 privacy) and the
// owner's active campaign banner (settings/mobile). One call so the home screen stays snappy.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  return withMember(req, (ctx) => memberHomeExtras(ctx))
}
