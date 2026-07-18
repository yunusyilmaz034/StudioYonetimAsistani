import { NextResponse, type NextRequest } from 'next/server'

import { memberLoginIdentifierAction } from '@/server/actions/portal-auth'

// PUBLIC (no Bearer): the app types the member's phone; the server derives the synthetic Firebase email
// she signs in with. Same public action the web login form calls — she never sees the identifier.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = (await req.json().catch(() => ({}))) as unknown
  const result = await memberLoginIdentifierAction(body)
  return NextResponse.json(result)
}
