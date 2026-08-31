'use server'

import { createHash, randomInt } from 'node:crypto'
import { type NextRequest } from 'next/server'
import { z } from 'zod'

import {
  crossTurnstile,
  FirestoreCheckinRepository,
  FirestoreEntitlementRepository,
  FirestoreMemberRepository,
  FirestoreReservationRepository,
  issueTurnstileCode,
  openTurnstileManually,
  systemClock,
  type CheckinDeps,
  type DeviceId,
  type MemberId,
  type TenantContext,
  available,
  entriesUsed,
} from '@studio/core'

import { adminDb } from '../firebase-admin'
import { requireTenantContext } from '../auth'

// ── TURNSTILE (v1.33) ────────────────────────────────────────────────────────────────────────
//
// Three callers, three different kinds of principal, and they must not be able to impersonate each
// other:
//
//   · the DEVICE asks for the next code — authenticated by its own secret (`deviceHeartbeatAuth`)
//   · the MEMBER asks to cross — authenticated by her member token, via `withMember`
//   · RECEPTION opens the arm by hand — authenticated by a staff session
//
// The device's secret is compared as a HASH. Storing it in the clear would mean anyone who can read
// the database can open the door, and the database is read by more people than the door should be.

const deps = (): CheckinDeps => ({
  repo: new FirestoreCheckinRepository(adminDb()),
  clock: systemClock,
  entries: new FirestoreEntitlementRepository(adminDb()),
  classes: new FirestoreReservationRepository(adminDb()),
})
const OPS = ['owner', 'receptionist', 'platform_admin'] as const
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')

/**
 * Authenticate the device from its `Authorization: Bearer <deviceId>.<secret>` header.
 *
 * Deliberately NOT a staff login. A box on a wall has no human to log in as, and lending it one
 * would make the log name a person for what a machine did (#5) — the check-in it produces carries
 * `actor: { type: 'device' }` precisely so nobody has to guess later.
 */
export async function deviceHeartbeatAuth(
  req: NextRequest,
): Promise<{ ok: true; ctx: TenantContext; deviceId: DeviceId } | { ok: false; error: { code: string } }> {
  const raw = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? ''
  const studioId = req.headers.get('x-studio-id') ?? ''
  const [deviceId, secret] = raw.split('.')
  if (!deviceId || !secret || !studioId) return { ok: false, error: { code: 'qr_invalid' } }

  const snap = await adminDb().doc(`studios/${studioId}/devices/${deviceId}`).get()
  const d = snap.data()
  // ONE error for every failure — unknown device, wrong secret, deactivated. A box probing the
  // endpoint must not learn which of the three it got wrong.
  if (!d || d.active !== true || d.secretHash !== sha256(secret)) return { ok: false, error: { code: 'qr_invalid' } }

  return {
    ok: true,
    deviceId: deviceId as DeviceId,
    ctx: {
      studioId: studioId as never,
      branchIds: [d.branchId as never],
      role: 'kiosk',
      actor: { type: 'device', id: deviceId as DeviceId },
    } as TenantContext,
  }
}

/** The next six digits for the screen. `randomInt` is the crypto one — a guessable door is no door. */
export async function deviceCodeAction(ctx: TenantContext, deviceId: DeviceId) {
  const digits = String(randomInt(0, 1_000_000)).padStart(6, '0')
  return issueTurnstileCode(deps(), ctx, deviceId, digits)
}

/**
 * The member scanned the screen.
 *
 * `direction` comes from the DEVICE via the app only when the arm's direction wire is connected; it
 * is optional and untrusted-but-harmless — the worst a wrong value does is record a crossing the
 * wrong way round, which the nightly sweep and the next real crossing both correct. It can never
 * open a door that the code itself did not already open.
 */
/**
 * "Did the code I am showing get used, and by whom?"
 *
 * The screen asks this every couple of seconds so it can say hello. It needs no new query and no new
 * index: `consumeTurnstileCode` already stamps `usedBy` / `usedAt` onto the code document, because
 * single use had to be a transaction anyway. The screen knows which code it is showing, so the code
 * IS the handle.
 *
 * ── WHY A FIRST NAME AND NOTHING ELSE ───────────────────────────────────────────────────────
 *
 * The screen hangs in a corridor and strangers walk past it. A first name is what a receptionist
 * would say out loud anyway; a surname, a package, a debt or a photograph are not. Events carry no
 * PII (I-13) and this does not change that — the name is read from `/members` at the moment of
 * display and never written anywhere.
 */
export async function deviceCrossingAction(ctx: TenantContext, deviceId: DeviceId, code: string) {
  const record = await deps().repo.getTurnstileCode(ctx, code)
  // Not this device's code ⇒ say nothing. A screen must never be able to watch another door.
  if (!record || record.deviceId !== deviceId) return { ok: true as const, value: { crossed: null } }
  if (!record.usedBy || !record.usedAt) {
    // Geçiş yok — ama bu kapıda az önce reddedilen biri olabilir.
    const ret = await sonRet(ctx, deviceId)
    return { ok: true as const, value: { crossed: null, ...(ret ? { refused: ret } : {}) } }
  }

  const member = await new FirestoreMemberRepository(adminDb()).findById(ctx, record.usedBy)
  const firstName = (member?.fullName ?? '').trim().split(/\s+/)[0] ?? ''
  return {
    ok: true as const,
    value: { crossed: { firstName, kalan: await kalanOzeti(ctx, record.usedBy), at: record.usedAt as number } },
  }
}

/** Son 20 saniyede bu kapıda reddedilmiş biri var mı? Ekran bunu bir kez gösterir ve siler. */
async function sonRet(ctx: TenantContext, deviceId: DeviceId): Promise<{ firstName: string } | null> {
  const ref = adminDb().doc(`studios/${ctx.studioId}/turnstileRefusals/${deviceId}`)
  const snap = await ref.get()
  if (!snap.exists) return null
  const at = Number(snap.get('at') ?? 0)
  // Eski bir ret ekranda belirirse, o an kapıda duran kişi kendi reddi sanır. Kısa tut.
  if (Date.now() - at > 20_000) return null
  // OKUNDU ⇒ SİL. Aksi halde ekran aynı reddi her turda tekrar gösterir ve kimse geçemez.
  await ref.delete()
  return { firstName: String(snap.get('firstName') ?? '') }
}

/**
 * KAPIDA GÖRÜLEN TEK SATIR: "6 ders · 23 gün" (owner, 2026-08-29).
 *
 * Üye kapıdan geçerken üç saniye ekrana bakıyor. O üç saniyede sorduğu soru "kaç hakkım kaldı" —
 * ve bugüne kadar cevabı için uygulamayı açması gerekiyordu. Kapı zaten kim olduğunu biliyor;
 * söylememesi için bir sebep yok.
 *
 * KISA TUTULUYOR, bilerek. Ekran 240 piksel geniş ve yazı üç saniye duruyor: iki kalem yeter,
 * gerisi okunmadan kayar. Sıralama en yakın biteni öne alıyor — acil olan o.
 */
async function kalanOzeti(ctx: TenantContext, memberId: MemberId): Promise<string> {
  const ents = await new FirestoreEntitlementRepository(adminDb()).listActiveByMember(ctx, memberId)
  const now = Date.now()
  const parcalar = [...ents]
    .sort((a, b) => (a.validUntil as number) - (b.validUntil as number))
    .map((e) => {
      const izin = e.productSnapshot.entryAllowance ?? null
      if (izin != null) return `${Math.max(0, izin - entriesUsed(e.entryLedger))} giris`
      if (e.credits) return `${available(e.credits)} ders`
      const gun = Math.ceil(((e.validUntil as number) - now) / 86_400_000)
      return gun > 0 ? `${gun} gun` : ''
    })
    .filter((x) => x !== '')
  // ASCII: ekran fontunda Türkçe harf yok, cihaz zaten dönüştürüyor — burada da sade tutuyoruz.
  return parcalar.slice(0, 2).join(' - ')
}

export async function crossOwnTurnstile(ctx: TenantContext, memberId: MemberId, input: unknown) {
  const p = z
    .object({
      code: z.string().trim().min(4).max(32),
      direction: z.enum(['in', 'out']).nullable().optional(),
    })
    .parse(input)
  const res = await crossTurnstile(deps(), ctx, {
    memberId,
    code: p.code,
    reportedDirection: p.direction ?? null,
  })

  // ── EKRANA DA SÖYLE (owner, 2026-08-31) ────────────────────────────────────────────────────
  //
  // Bir ret KODU HARCAMAZ — bilerek, çünkü üye paketini yeniletip aynı ekranı okutabilmeli. Ama
  // ekran geçişleri "kod kullanıldı mı?" diye sorarak öğreniyor; harcanmamış bir kod, ekran için
  // hiç olmamış bir okutma demek. Yani kapıda üye "resepsiyona uğrayın" yazısını GÖREMEZDİ,
  // yalnızca telefonu uyarırdı — turnikenin sessizce açılmaması, bozuk sanılırdı.
  //
  // Kodun kendisine alan eklemek yerine cihaz başına TEK bir "son ret" kaydı: ret geçici bir
  // arayüz sinyalidir, kodun kimliğinin parçası değil. Üzerine yazılır, indeks istemez, kodun
  // yaşam döngüsüne dokunmaz.
  if (!res.ok && res.error.code === 'no_active_membership') {
    const rec = await deps().repo.getTurnstileCode(ctx, p.code)
    if (rec) {
      const member = await new FirestoreMemberRepository(adminDb()).findById(ctx, memberId)
      await adminDb()
        .doc(`studios/${ctx.studioId}/turnstileRefusals/${rec.deviceId}`)
        .set({
          // Ad, ekranda karşılamada olduğu gibi yalnızca ilk isim: koridorda yabancılar geçiyor.
          firstName: (member?.fullName ?? '').trim().split(/\s+/)[0] ?? '',
          reason: 'no_active_membership',
          at: Date.now(),
        })
    }
  }
  return res
}

/** Reception opens the arm for a guest. Records WHO opened it, and nothing about a member. */
export async function openTurnstileAction(input: unknown) {
  const p = z.object({ deviceId: z.string().min(1), reason: z.string().trim().min(1).max(200) }).parse(input)
  const ctx = await requireTenantContext(OPS)
  return openTurnstileManually(deps(), ctx, p.deviceId as DeviceId, p.reason)
}

/** The panel's device list — name, branch, and whether the door has spoken to us lately. */
export async function listTurnstilesAction() {
  const ctx = await requireTenantContext(OPS)
  const devices = await deps().repo.listDevices(ctx)
  return devices.map((d) => ({
    id: d.id as string,
    name: d.name,
    branchId: d.branchId as string,
    active: d.active,
    lastSeenAt: d.lastSeenAt === null ? null : Number(d.lastSeenAt),
  }))
}
