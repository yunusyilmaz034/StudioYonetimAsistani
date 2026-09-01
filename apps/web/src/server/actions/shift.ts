'use server'

import {
  FirestoreStaffShiftRepository,
  endShift,
  startShift,
  systemClock,
  type BranchId,
  type StaffUserId,
} from '@studio/core'

import { requireTenantContext } from '../auth'
import { adminDb } from '../firebase-admin'

// MESAİ — "saat kaçta girdi çıktı" (owner, 2026-09-01).
//
// Server Action, `/commands` değil: mesai ne çevrimdışı çalışmak zorunda ne de idempotent. Bir kez
// basılır, sunucuya ulaşır, biter. Yazma yolu testinin cevabı bu (Doc 01).
//
// AKTÖR HER ZAMAN OTURUMUN KENDİSİ: `staffUserId` istemciden HİÇ alınmıyor. Alsaydı, ekrandaki bir
// alanı değiştiren biri bir başkasının adına mesai açabilirdi — ve mesai kaydının tek değeri,
// kimin yazdığına güvenilebilmesi.

const HERKES = ['owner', 'receptionist', 'trainer', 'platform_admin'] as const

const deps = () => ({ repo: new FirestoreStaffShiftRepository(adminDb()), clock: systemClock })

export async function startShiftAction(input: { branchId?: string | null } = {}) {
  const ctx = await requireTenantContext(HERKES)
  return startShift(deps(), ctx, {
    staffUserId: String(ctx.actor.id) as StaffUserId,
    branchId: (input.branchId ?? null) as BranchId | null,
  })
}

export async function endShiftAction() {
  const ctx = await requireTenantContext(HERKES)
  return endShift(deps(), ctx, { staffUserId: String(ctx.actor.id) as StaffUserId })
}
