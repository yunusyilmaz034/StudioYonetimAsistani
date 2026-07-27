import { type NextRequest } from 'next/server'

import { NextResponse } from 'next/server'

import { authenticateMember, deleteMemberAccount } from '@/server/member-api'

// "Hesabımı sil" — App Store guideline 5.1.1(v), 2026-07-27.
//
// An app with accounts must let the user delete hers from inside the app. Ours are created by the
// studio, not by the member, which arguably exempts us — but a reviewer sees a login screen and
// expects a way out, and winning that argument costs a week of review time.
//
// POST only, and no body: there is nothing to parameterise. Whose account is being deleted comes out
// of the verified Bearer token, never a request field — the same perimeter as every other member
// route (D11). A `memberId` parameter here would be a way to delete somebody else.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  // Not `withMember`: this is the one route that needs the Firebase uid as well as the memberId, and
  // it takes it from the verified token rather than the body — a `uid` parameter here would be a way
  // to delete somebody else's login.
  const auth = await authenticateMember(req)
  if (!auth) return NextResponse.json({ ok: false, error: { code: 'unauthorized' } }, { status: 401 })
  return NextResponse.json(await deleteMemberAccount(auth.ctx, auth.memberId, auth.uid, 'member_app'))
}
