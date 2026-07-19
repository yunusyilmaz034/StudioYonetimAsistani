import { requireMemberContext } from '@/server/auth'
import { memberStore } from '@/server/member-api'
import { readWalletView } from '@/server/wallet-query'

import { PortalWalletScreen } from './wallet-screen'

export const dynamic = 'force-dynamic'

export default async function PortalWallet() {
  const { ctx, memberId } = await requireMemberContext()
  const [wallet, store] = await Promise.all([readWalletView(ctx, memberId), memberStore(ctx)])
  return <PortalWalletScreen wallet={wallet} store={[...store]} />
}
