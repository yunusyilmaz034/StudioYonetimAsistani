import { NextResponse, type NextRequest } from 'next/server'

import { getMobileBrandingPublic } from '@/server/actions/mobile-settings'

// PUBLIC (no Bearer) — the login screen shows the studio's name + logo before anyone signs in. Only
// the app's branding is returned, nothing member-specific.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest): Promise<NextResponse> {
  const studioId = req.nextUrl.searchParams.get('s') ?? ''
  if (!studioId) return NextResponse.json({ branding: null })
  const branding = await getMobileBrandingPublic(studioId)
  return NextResponse.json({ branding })
}
