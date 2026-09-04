import { type NextRequest } from 'next/server'

import { memberPayCafeFromWallet, withMember } from '@/server/member-api'

// Üye kafe hesabını cüzdanından kapatır (owner, 2026-09-04). Tutar ve hangi satışların kapanacağı
// SUNUCUDA belirlenir — istek gövdesinde rakam YOKTUR, çünkü istemciden gelen bir tutara göre borç
// kapatmak borcu istemciye yazdırmaktır. `memberId` de token'dan gelir, istekten değil.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  return withMember(req, (ctx, memberId) => memberPayCafeFromWallet(ctx, memberId))
}
