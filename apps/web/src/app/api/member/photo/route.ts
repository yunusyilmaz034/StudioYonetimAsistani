import { type NextRequest } from 'next/server'

import { memberUploadPhoto, withMember } from '@/server/member-api'

// The member's own profile photo. The app sends a base64 data URL (compressed on device); we store it
// in private Storage and return a signed URL. memberId comes from her token, never the request.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { dataUrl?: string }
  return withMember(req, (ctx, memberId) => {
    if (!body.dataUrl) return Promise.resolve({ ok: false as const, error: { code: 'image_required' } })
    return memberUploadPhoto(ctx, memberId, body.dataUrl)
  })
}
