import { type NextRequest } from 'next/server'

import { z } from 'zod'

import { memberPrefsGet, memberPrefsSet, withMember } from '@/server/member-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET — her channel preferences (in_app is never switchable — it is her record). POST — set them.
export async function GET(req: NextRequest) {
  return withMember(req, (ctx, memberId) => memberPrefsGet(ctx, memberId))
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as unknown
  const prefs = z
    .object({
      email: z.boolean(),
      sms: z.boolean(),
      whatsapp: z.boolean(),
      push: z.boolean(),
      campaign: z.boolean(),
    })
    .parse(body)
  return withMember(req, (ctx, memberId) => memberPrefsSet(ctx, memberId, prefs))
}
