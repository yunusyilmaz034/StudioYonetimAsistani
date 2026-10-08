'use server'

import { z } from 'zod'

import { studioDayStart } from '@/lib/ranges'

import { loadCashMovements, type CashMovement } from '../cash-movements'
import { requireTenantContext } from '../auth'
import { reportPinIsDefault, reportsUnlocked } from '../report-pin'

// Kasa hareketleri — owner ve resepsiyon OKUR. Para çıkarmak owner'a özel (bkz. `withdrawCashAction`);
// ne olup bittiğini görmek değil: resepsiyon kasayı o kullanıyor ve neyin girdiğini görmeden sayamaz.
const OPS = ['owner', 'receptionist', 'platform_admin'] as const

export interface CashMovementsResult {
  readonly rows: readonly CashMovement[]
  /** Kilit kapalı: `rows` yalnızca BUGÜN'ü taşıyor, istenen pencere ne olursa olsun. */
  readonly locked: boolean
  /** PIN hiç değiştirilmemişse ekran bunu uyarı olarak söyler — değerini asla. */
  readonly varsayilanPin: boolean
}

// ── BUGÜN AÇIK, GERİSİ PIN'Lİ (owner, 2026-10-08 · [[OR-117]]) ─────────────────────────────
//
// *"Bu ekranda sadece bugün açık olsun, diğer her filtre PIN kodu ile sorulsun — raporlara
// eklediğimiz PIN'in aynısı."*
//
// Bugün, masanın İŞİ: kasayı sayacak kişi o gün neyin girdiğini görmek zorunda. Dün, geçen hafta ve
// yılın toplamı ise stüdyonun cirosu — rapor ekranında PIN'in arkasına konan şeyin ta kendisi, ve
// bu ekrandan PIN'siz okunabiliyordu.
//
// KİLİT SUNUCUDA. Pencereyi istemci seçiyor; düğmeyi gizlemek yetmezdi, çünkü aynı eylem başka bir
// pencereyle çağrılabilir. Kilit kapalıyken istenen aralık ne olursa olsun dönen şey bugündür.
export async function loadCashMovementsAction(input: unknown): Promise<CashMovementsResult> {
  const p = z.object({ fromMs: z.number().int(), toMs: z.number().int() }).parse(input)
  const ctx = await requireTenantContext(OPS)
  const acik = await reportsUnlocked(String(ctx.studioId), String(ctx.actor.id))
  const now = Date.now()
  const rows = acik ? await loadCashMovements(ctx, p.fromMs, p.toMs) : await loadCashMovements(ctx, studioDayStart(now), now)
  return { rows, locked: !acik, varsayilanPin: acik ? false : await reportPinIsDefault(String(ctx.studioId)) }
}
