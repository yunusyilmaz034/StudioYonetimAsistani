'use server'

import { requireTenantContext } from '../auth'
import { allowRate } from '../rate-limit'
import { changeReportPin, lockReports, reportPinIsDefault, unlockReports, verifyReportPin } from '../report-pin'

// Rapor PIN'inin dış kapısı. Üç iş: kilidi aç, kilitle, PIN'i değiştir.
//
// PIN'in KENDİSİ hiçbir zaman dışarı çıkmıyor — ne buradan, ne ayarlar ekranından. Dışarı çıkan tek
// şey "hiç değiştirilmemiş mi" bilgisi, ve o bir uyarı için gerekli.
const OWNER = ['owner', 'platform_admin'] as const

export async function unlockReportsAction(input: unknown): Promise<{ ok: true } | { ok: false; code: 'wrong_pin' | 'too_many' }> {
  const pin = typeof input === 'string' ? input : ''
  const ctx = await requireTenantContext(OWNER)
  // Altı hane, tek tek denenebilir. Oturum zaten owner'ın ama kapının arkasındaki kişi owner
  // olmayabilir — bu kilidin bütün varlık sebebi o. On dakikada beş deneme.
  if (!(await allowRate(String(ctx.studioId), 'report_pin', 5, 10 * 60 * 1000))) {
    return { ok: false, code: 'too_many' }
  }
  if (!(await verifyReportPin(String(ctx.studioId), pin))) return { ok: false, code: 'wrong_pin' }
  await unlockReports(String(ctx.studioId), String(ctx.actor.id))
  return { ok: true }
}

export async function lockReportsAction(): Promise<{ ok: true }> {
  await requireTenantContext(OWNER)
  await lockReports()
  return { ok: true }
}

export async function reportPinStatusAction(): Promise<{ varsayilan: boolean }> {
  const ctx = await requireTenantContext(OWNER)
  return { varsayilan: await reportPinIsDefault(String(ctx.studioId)) }
}

export async function changeReportPinAction(input: unknown): Promise<{ ok: true } | { ok: false; code: 'wrong_pin' | 'weak_pin' }> {
  const p = (input ?? {}) as { current?: unknown; next?: unknown }
  const ctx = await requireTenantContext(OWNER)
  return changeReportPin(
    String(ctx.studioId),
    String(ctx.actor.id),
    typeof p.current === 'string' ? p.current : '',
    typeof p.next === 'string' ? p.next : '',
  )
}
