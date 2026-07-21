import { type NextRequest } from 'next/server'

import { memberStudioContact, withMember } from '@/server/member-api'

// The studio's contact card (phone / WhatsApp / address / maps) shown on the app's İletişim screen.
// Business info, not member PII — sourced from settings/studio.company (Ayarlar → Genel).
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  return withMember(req, (ctx) => memberStudioContact(ctx))
}
