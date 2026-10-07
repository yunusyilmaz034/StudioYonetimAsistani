'use server'

import { z } from 'zod'

import {
  FirestoreStaffTimesheetRepository,
  generateTimesheet,
  mondayOf,
  signTimesheet,
  systemClock,
  type StaffUserId,
} from '@studio/core'

import { requireTenantContext } from '../auth'
import { adminDb } from '../firebase-admin'
import { buildWeekSnapshots } from '../timesheet-query'

// HAFTALIK ÇİZELGE ÜRETİMİ (owner, 2026-10-07 · OR-119 · Faz 6).
//
// Server Action: çizelge çevrimdışı üretilmek zorunda değil ve masadan, bilerek, bir kez basılıyor.
//
// SNAPSHOT İSTEMCİDEN ALINMIYOR. Alınsaydı ekrandaki bir sayıyı değiştiren biri, imzalanacak kâğıda
// istediğini yazdırabilirdi — ve çizelgenin tek değeri, sunucunun kayıttan hesapladığı şey olması.
// İstemci yalnızca HANGİ haftayı söylüyor.
//
// Kimin üretebileceği kararda (`decideGenerateTimesheet`): patron ve resepsiyon. Buradaki rol
// listesi yalnızca kapıyı erken kapatıyor.

const MASA = ['owner', 'receptionist', 'platform_admin'] as const

export interface GenerateTimesheetsResult {
  /** Yeni sürüm basılanlar. */
  readonly uretilen: number
  /** Kayıtlı kâğıtla aynı çıkanlar — yeniden basılmadı. */
  readonly degismeyen: number
  /** Planı da hareketi de olmayanlar — boş kâğıt basılmadı. */
  readonly bos: number
}

export async function generateWeekTimesheetsAction(
  input: unknown,
): Promise<{ ok: true; value: GenerateTimesheetsResult } | { ok: false; error: { code: string } }> {
  const p = z.object({ weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).safeParse(input)
  if (!p.success || mondayOf(p.data.weekStart) !== p.data.weekStart) {
    return { ok: false, error: { code: 'invalid_input' } }
  }
  const ctx = await requireTenantContext(MASA)
  const deps = { repo: new FirestoreStaffTimesheetRepository(adminDb()), clock: systemClock }
  const { kisiler } = await buildWeekSnapshots(ctx, p.data.weekStart)

  let uretilen = 0
  let degismeyen = 0
  let bos = 0
  for (const k of kisiler) {
    if (k.bos) {
      bos++
      continue
    }
    const r = await generateTimesheet(deps, ctx, k.snapshot)
    if (r.ok) uretilen++
    else if (r.error.code === 'timesheet_unchanged') degismeyen++
    else return { ok: false, error: { code: r.error.code } }
  }
  return { ok: true, value: { uretilen, degismeyen, bos } }
}

// ── ISLAK İMZANIN İŞARETLENMESİ (OR-119 · Faz 7) ────────────────────────────────────────────
//
// Kâğıdın kendisi sistemin dışında — dosyada duruyor. Burada işaretlenen tek şey imzanın ALINDIĞI;
// böylece "hangi hafta imzalanmadı" sorusu cevaplanabilir. İşaret haftanın EN YENİ sürümüne konur:
// bir düzeltmeden sonra yeni sürüm imzasız başlar ve önceki imza onu kapsamaz.
//
// Geri alınamaz, bilerek: imzalanmış bir kâğıdın imzası sistemden silinemez. Yanlış işaretlendiyse
// düzeltmenin yolu yeni bir sürümdür.
export async function signTimesheetAction(input: unknown) {
  const p = z
    .object({ weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), staffUserId: z.string().min(1).max(128) })
    .safeParse(input)
  if (!p.success) return { ok: false as const, error: { code: 'invalid_input' as const } }
  const ctx = await requireTenantContext(MASA)
  return signTimesheet(
    { repo: new FirestoreStaffTimesheetRepository(adminDb()), clock: systemClock },
    ctx,
    { weekStart: p.data.weekStart, staffUserId: p.data.staffUserId as StaffUserId },
  )
}
