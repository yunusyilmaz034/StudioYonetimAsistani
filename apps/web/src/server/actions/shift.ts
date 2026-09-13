'use server'

import { z } from 'zod'

import {
  FirestoreCheckinRepository,
  FirestoreEntitlementRepository,
  FirestoreReservationRepository,
  FirestoreStaffShiftRepository,
  commitStaffCrossing,
  endShift,
  prepareStaffCrossing,
  staffCrossTurnstile,
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

// ── TURNİKEDEN MESAİ (owner, 2026-09-13 · OR-74) ────────────────────────────────────────────
//
// *"Eğitmenlerin gün içinde ilk QR okutması mesai başlangıcı, son okutması mesai çıkışı sayılsın."*
//
// Eğitmen turnike ekranındaki kodu KENDİ panelinden okutur. İki modül burada birbirine bağlanıyor:
// kodu `checkin` tanır ve harcar, vardiyayı `identity` yazar — çekirdekte ikisi birbirini tanımıyor.
//
// Aktör yine oturumun kendisi: `staffUserId` istemciden ALINMIYOR. Alınsaydı bir telefon bir başkası
// adına kapıdan geçip onun mesaisini açabilirdi.
export async function staffCrossTurnstileAction(input: unknown) {
  const p = z.object({ code: z.string().trim().regex(/^\d{6}$/) }).safeParse(input)
  if (!p.success) return { ok: false as const, error: { code: 'qr_invalid' as const } }
  const ctx = await requireTenantContext(HERKES)
  const db = adminDb()
  const shiftDeps = deps()
  return staffCrossTurnstile(
    {
      repo: new FirestoreCheckinRepository(db),
      clock: systemClock,
      entries: new FirestoreEntitlementRepository(db),
      classes: new FirestoreReservationRepository(db),
      staffCrossing: {
        prepare: (c, i) => prepareStaffCrossing(shiftDeps, c, { ...i, deviceId: String(i.deviceId) }),
        commit: (c, prepared) => commitStaffCrossing(shiftDeps, c, prepared),
      },
    },
    ctx,
    { staffUserId: String(ctx.actor.id) as StaffUserId, code: p.data.code, reportedDirection: null },
  )
}
