'use server'

import { z } from 'zod'

import { loadCashMovements, type CashMovement } from '../cash-movements'
import { requireTenantContext } from '../auth'

// Kasa hareketleri — owner ve resepsiyon OKUR. Para çıkarmak owner'a özel (bkz. `withdrawCashAction`);
// ne olup bittiğini görmek değil: resepsiyon kasayı o kullanıyor ve neyin girdiğini görmeden sayamaz.
const OPS = ['owner', 'receptionist', 'platform_admin'] as const

export async function loadCashMovementsAction(input: unknown): Promise<readonly CashMovement[]> {
  const p = z.object({ fromMs: z.number().int(), toMs: z.number().int() }).parse(input)
  const ctx = await requireTenantContext(OPS)
  return loadCashMovements(ctx, p.fromMs, p.toMs)
}
