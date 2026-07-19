import { type NextRequest } from 'next/server'

import { memberStore, withMember } from '@/server/member-api'

// The retail shelf she can buy from her wallet — su, çorap, havlu, supplement…
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  return withMember(req, (ctx) => memberStore(ctx))
}
