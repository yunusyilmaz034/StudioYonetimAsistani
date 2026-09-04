'use server'

import { memberPayCafeFromWallet } from '../member-api'
import { requireMemberContext } from '../auth'

// Portaldaki "Cüzdanımdan öde" düğmesinin sunucu tarafı. Mobil aynı işi `/api/member/cafe-pay`
// üzerinden yapıyor — İKİSİ DE `memberPayCafeFromWallet`i çağırıyor, yani kural tek yerde. İki uç
// iki kez yazılsaydı, biri paket borcunu da kapatır hâle gelirdi ve fark aylarca görülmezdi.
export async function payCafeFromWalletAction() {
  const { ctx, memberId } = await requireMemberContext()
  return memberPayCafeFromWallet(ctx, memberId)
}
