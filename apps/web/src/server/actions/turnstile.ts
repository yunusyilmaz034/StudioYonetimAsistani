'use server'

import { createHash, randomBytes, randomInt } from 'node:crypto'
import { type NextRequest } from 'next/server'
import { z } from 'zod'

import {
  crossTurnstile,
  FirestoreCheckinRepository,
  FirestoreIdentityRepository,
  FirestoreEntitlementRepository,
  FirestoreMemberRepository,
  FirestoreReservationRepository,
  issueTurnstileCode,
  openTurnstileManually,
  instant,
  DEFAULT_STUDIO_CONFIG,
  FirestoreSchedulingRepository,
  FirestoreStudioHours,
  getHold,
  recordGuestArrival,
  recordCheckIn,
  requestDeviceRestart,
  type DeviceTelemetry,
  registerDevice,
  rotateDeviceSecret,
  setDeviceActive,
  systemClock,
  type BranchId,
  type CheckinDeps,
  type DeviceId,
  type MemberId,
  type StaffUserId,
  type TenantContext,
  available,
  entriesUsed,
} from '@studio/core'

import { adminDb } from '../firebase-admin'
import { requireTenantContext } from '../auth'
import { markCrossingSeen, openIfCodeLeftScreen, openIfPreviousCodeUnseen } from '../turnstile-missed'
import { SCREEN_REFUSALS, showRefusalOnScreen } from '../turnstile-refusal'

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
export async function deviceCodeAction(ctx: TenantContext, deviceId: DeviceId, telemetry: DeviceTelemetry | null = null) {
  const digits = String(randomInt(0, 1_000_000)).padStart(6, '0')
  // Ekrandan kalkacak kod (2026-09-14): cihaz yeni kod istiyorsa eskisini bir daha sormayacak. O kod kullanılmış
  // ama cihaz görmemişse, kol şimdi — bir sonraki sorguda — sunucudan açılır. Bkz. `turnstile-missed.ts`.
  const onceki = (await deps().repo.getDevice(ctx, deviceId))?.currentCode ?? null
  const res = await issueTurnstileCode(deps(), ctx, deviceId, digits, telemetry)
  await openIfPreviousCodeUnseen(ctx, deviceId, onceki)
  return res
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
    // Geçiş yok — ama bu kapıda az önce reddedilen biri ya da panelden verilmiş bir açma olabilir.
    const [ret, ac] = await Promise.all([sonRet(ctx, deviceId), bekleyenAcma(ctx, deviceId)])
    // UZAKTAN YENİDEN BAŞLAT (2026-09-14, firmware v1.4) — aynı tek-komut kanalı. Eski firmware bu anahtarı tanımaz,
    // yok sayar; komut okununca silindiği için bir sonraki turda tekrar gelmez.
    if (ac?.action === 'restart') return { ok: true as const, value: { crossed: null, restart: { reason: ac.reason } } }
    return { ok: true as const, value: { crossed: null, ...(ret ? { refused: ret } : {}), ...(ac ? { open: { reason: ac.reason } } : {}) } }
  }

  // GÖRÜLDÜ DAMGASI — cihaza "geçti" demeden ÖNCE (2026-09-14). Sıra önemli: cihaz bu cevaptan sonra yeni kod
  // isteyecek, ve yenileme anındaki "kullanılmış ama görülmemiş" kontrolü bu damgaya bakıyor. Damga cevaptan
  // sonra yazılsaydı aynı geçiş için kol iki kez açılabilirdi. Gecikme de buradan loga düşer.
  await markCrossingSeen(ctx, code, record.usedAt as number)

  // PERSONEL GEÇTİ (owner, 2026-09-13 · OR-74). Adı `/members`ten değil `/staff`ten, ve KALAN HAK
  // YOK: personelin paketi yok, "0 ders" yazmak ise kapıda yanlış bir şey söylemek olurdu. Cihaz boş
  // `kalan`ı zaten hiç çizmiyor.
  if (record.usedByKind === 'staff') {
    const staff = await new FirestoreIdentityRepository(adminDb()).getStaff(ctx, record.usedBy as unknown as StaffUserId)
    const ad = (staff?.displayName ?? '').trim().split(/\s+/)[0] ?? ''
    return { ok: true as const, value: { crossed: { firstName: ad, kalan: '', at: record.usedAt as number } } }
  }

  const member = await new FirestoreMemberRepository(adminDb()).findById(ctx, record.usedBy)
  const firstName = (member?.fullName ?? '').trim().split(/\s+/)[0] ?? ''
  return {
    ok: true as const,
    value: { crossed: { firstName, kalan: await kalanOzeti(ctx, record.usedBy), at: record.usedAt as number } },
  }
}

/**
 * Panelden verilmiş bir AÇ komutu var mı? (owner, 2026-09-01)
 *
 * `openTurnstileManually` 2026-08 sonunda yazıldığından beri bir olay yazıyor ve **cihaza hiç
 * ulaşmıyordu** — yani panelden "aç" demek kolu hiç döndürmedi. Ekran geçişleri "kod kullanıldı mı?"
 * diye öğreniyor; elle açmanın bir kodu yok, dolayısıyla cihazın haberi olacak bir yol da yoktu.
 *
 * Ret bildirimiyle aynı desen: cihaz başına TEK bir komut kaydı, kısa ömürlü, okununca silinir.
 * Kalıcı bir kuyruk kurmadım — açılmamış bir "aç" komutu on dakika sonra çalışırsa, kapı kimsenin
 * beklemediği bir anda döner.
 */
async function bekleyenAcma(ctx: TenantContext, deviceId: DeviceId): Promise<{ reason: string; action: string } | null> {
  const ref = adminDb().doc(`studios/${ctx.studioId}/turnstileCommands/${deviceId}`)
  const snap = await ref.get()
  if (!snap.exists) return null
  const at = Number(snap.get('at') ?? 0)
  // 20 saniye: resepsiyon düğmeye bastığında kişi kapıda duruyordur. Daha uzun bir pencere,
  // vazgeçilmiş bir açmanın sonradan gerçekleşmesi demek.
  if (Date.now() - at > 20_000) {
    await ref.delete()
    return null
  }
  await ref.delete()
  return { reason: String(snap.get('reason') ?? ''), action: String(snap.get('action') ?? 'open') }
}

/** Son 20 saniyede bu kapıda reddedilmiş biri var mı? Ekran bunu bir kez gösterir ve siler. */
async function sonRet(ctx: TenantContext, deviceId: DeviceId): Promise<{ firstName: string; reason: string } | null> {
  const ref = adminDb().doc(`studios/${ctx.studioId}/turnstileRefusals/${deviceId}`)
  const snap = await ref.get()
  if (!snap.exists) return null
  const at = Number(snap.get('at') ?? 0)
  // Eski bir ret ekranda belirirse, o an kapıda duran kişi kendi reddi sanır. Kısa tut.
  if (Date.now() - at > 20_000) return null
  // OKUNDU ⇒ SİL. Aksi halde ekran aynı reddi her turda tekrar gösterir ve kimse geçemez.
  await ref.delete()
  // `reason` cihaz mesajı seçiyor (v1.5): "az önce geçtiniz" ile "resepsiyona uğrayın" aynı şey değil.
  return { firstName: String(snap.get('firstName') ?? ''), reason: String(snap.get('reason') ?? 'no_active_membership') }
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

  // ENSTRÜMAN (2026-09-14): reddedilen okutmalar hiçbir yere yazılmıyordu — 11:23'teki on başarısız denemenin
  // sebebi bu yüzden bilinemedi. Kimlik yok (üye kimliği de loga girmez), yalnızca stüdyo ve hata kodu.
  if (!res.ok) console.warn('[turnstile] member crossing refused', { studioId: ctx.studioId, code: res.error.code })
  // Geçiş yazıldı ama okutulan kod ekrandan kalkmışsa cihaz onu görmeyecek: kolu sunucudan aç.
  if (res.ok) await openIfCodeLeftScreen(ctx, res.value.deviceId, p.code)

  // ── EKRANA DA SÖYLE (owner, 2026-08-31; 2026-09-15 bütün anlamlı retler) ─ bkz. `turnstile-refusal.ts`
  if (!res.ok && (SCREEN_REFUSALS as readonly string[]).includes(res.error.code)) {
    const member = await new FirestoreMemberRepository(adminDb()).findById(ctx, memberId)
    await showRefusalOnScreen(ctx, p.code, res.error.code, (member?.fullName ?? '').trim().split(/\s+/)[0] ?? '')
  }
  return res
}

/**
 * Resepsiyon kolu açar. KİMİN açtığını kaydeder, üye hakkında hiçbir şey kaydetmez.
 *
 * 2026-09-01: artık gerçekten AÇIYOR. Olay yazmak yetmiyordu — cihazın haberi olması gerekiyordu.
 */
export async function openTurnstileAction(input: unknown) {
  const p = z.object({ deviceId: z.string().min(1), reason: z.string().trim().min(1).max(200) }).parse(input)
  const ctx = await requireTenantContext(OPS)
  const res = await openTurnstileManually(deps(), ctx, p.deviceId as DeviceId, p.reason)
  if (!res.ok) return res
  // Olay YAZILDIKTAN sonra komut bırakılır. Ters sırada, kaydı olmayan bir açılma olabilirdi —
  // kapının kaydı olmayan her hareketi, sonradan kimsenin hesabını veremeyeceği bir hareket.
  await adminDb()
    .doc(`studios/${ctx.studioId}/turnstileCommands/${p.deviceId}`)
    .set({ action: 'open', at: Date.now(), by: String(ctx.actor.id), reason: p.reason })
  return res
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
    // Hangi kapı. Ekran "Giriş"i ve "Çıkış"ı ayrı düğme olarak gösterebilsin diye — iki kapıya tek
    // düğme koymak, resepsiyona hangisinin açıldığını tahmin ettirmek olurdu.
    side: (d as { side?: 'in' | 'out' }).side ?? null,
    // Firmware v1.4 ölçümü — WiFi gücü, açık kalma süresi, yeniden başlama sebebi. Eski firmware'de `null`.
    telemetry: d.telemetry
      ? {
          fw: d.telemetry.fw,
          rssi: d.telemetry.rssi,
          heap: d.telemetry.heap,
          uptimeS: d.telemetry.uptimeS,
          pulses: d.telemetry.pulses,
          resetReason: d.telemetry.resetReason,
          at: d.telemetry.at === undefined ? null : Number(d.telemetry.at),
        }
      : null,
  }))
}

/**
 * KUTUYU UZAKTAN YENİDEN BAŞLAT (2026-09-14, firmware v1.4).
 *
 * Owner: *"devamlı elektriği kes demek sıkıntı."* Resepsiyon da kullanabilir — kapıda kalan üye onun karşısında.
 * İki ekran TEK kutuda: hangi cihaza basılırsa basılsın ikisi birlikte ~20 sn kapanır. Olay önce yazılır, komut
 * sonra bırakılır (elle açmayla aynı sıra). v1.3 firmware komutu tanımaz ve yok sayar.
 */
export async function restartTurnstileAction(input: unknown) {
  const p = z.object({ deviceId: z.string().min(1), reason: z.string().trim().min(1).max(200) }).parse(input)
  const ctx = await requireTenantContext(OPS)
  const res = await requestDeviceRestart(deps(), ctx, { deviceId: p.deviceId as DeviceId, reason: p.reason })
  if (!res.ok) return { ok: false as const, error: res.error }
  await adminDb()
    .doc(`studios/${ctx.studioId}/turnstileCommands/${p.deviceId}`)
    .set({ action: 'restart', at: Date.now(), by: String(ctx.actor.id), reason: p.reason })
  return { ok: true as const }
}

// ── CİHAZ YÖNETİMİ (owner onayı, 2026-09-11 — ikinci stüdyo hazırlığı) ──────────────────────
//
// İlk iki cihaz ELLE oluşturulmuştu; panelde ekleme ekranı yoktu. Yani her yeni kapı bir Mac, bir
// yazılımcı ve bir gece demekti. `TURNSTILE-HARDWARE.md` §5 bunu ikinci stüdyodan önce kapatılacak
// üç işten biri olarak yazmıştı, ve sebebi de: *"ikinci kapı takıldığı anda bunlar birer arıza
// olarak geri gelir."*
//
// SIR BİR KEZ GÖSTERİLİR. Veritabanında yalnızca SHA-256 özeti duruyor. Kaybolursa üretilmez,
// DÖNDÜRÜLÜR — çünkü sırrı geri getirebilen bir sistem, onu saklıyor demektir ve o zaman
// veritabanını okuyabilen herkes kapıyı açabilir.
//
// OWNER-ONLY. Resepsiyon kapıyı AÇAR ama kapının anahtarını üretmez: bu ayrım, panelin
// yetkilendirmesinin taşıdığı en pahalı ayrımlardan biri.

const OWNER_ONLY = ['owner', 'platform_admin'] as const

export async function createTurnstileDeviceAction(input: unknown) {
  const p = z
    .object({
      name: z.string().trim().min(1).max(60),
      branchId: z.string().min(1),
      side: z.enum(['in', 'out']).nullable().default(null),
    })
    .parse(input)
  const ctx = await requireTenantContext(OWNER_ONLY)

  // Kimlik ve sır BURADA üretiliyor — domain saf kalsın diye (`Math.random` orada yasak) ve
  // rastgeleliği tohumlanabilir bir yerde tutmak sınanabilirlik için tek yol.
  const deviceId = `dev_${randomBytes(10).toString('hex')}` as DeviceId
  // 24 bayt: tahmin edilemez, ve `deviceId.secret` biçiminde bir HTTP başlığına sığacak kadar kısa.
  const secret = randomBytes(24).toString('base64url')

  const res = await registerDevice(deps(), ctx, {
    deviceId,
    branchId: p.branchId as BranchId,
    name: p.name,
    side: p.side,
    secretHash: sha256(secret),
  })
  if (!res.ok) return { ok: false as const, error: res.error }

  // BİR KEZ. Çağıran ekran bunu gösterir ve bir daha hiçbir yerden okunamaz.
  return { ok: true as const, deviceId: deviceId as string, pairing: `${deviceId}.${secret}` }
}

export async function rotateTurnstileSecretAction(input: unknown) {
  const p = z.object({ deviceId: z.string().min(1), reason: z.string().trim().min(1).max(200) }).parse(input)
  const ctx = await requireTenantContext(OWNER_ONLY)
  const secret = randomBytes(24).toString('base64url')
  const res = await rotateDeviceSecret(deps(), ctx, {
    deviceId: p.deviceId as DeviceId,
    secretHash: sha256(secret),
    reason: p.reason,
  })
  if (!res.ok) return { ok: false as const, error: res.error }
  // Eski sır bu satırdan itibaren ÖLÜ: duvardaki kutu yeni sırrı alana kadar kapı açmayacak, ve
  // bu bilerek böyle — kaybolmuş bir anahtarı bir süre daha geçerli tutmanın adı sızıntıdır.
  return { ok: true as const, pairing: `${p.deviceId}.${secret}` }
}

export async function setTurnstileDeviceActiveAction(input: unknown) {
  const p = z.object({ deviceId: z.string().min(1), active: z.boolean() }).parse(input)
  const ctx = await requireTenantContext(OWNER_ONLY)
  const res = await setDeviceActive(deps(), ctx, { deviceId: p.deviceId as DeviceId, active: p.active })
  if (!res.ok) return { ok: false as const, error: res.error }
  return { ok: true as const }
}

// ── PANELDEN ÜYE GEÇİŞİ (owner, 2026-09-13) ─────────────────────────────────────────────────
//
// *"Üye kendisi QR okutmuş gibi tüm kurallar geçerli olsun."*
//
// YENİ BİR KURAL YAZILMADI ve yazılmamalıydı: kurallar zaten `recordCheckIn`in içinde ve owner'ın
// tarif ettiği davranışın tamamı orada:
//   · Giriş saatine yakın bir DERSİ varsa fitness sayacı İŞLEMEZ — o giriş dersin girişidir.
//   · Hibrit/limitli fitness paketi varsa bir GİRİŞ hakkı düşer (`entryAllowance`).
//   · Sınırsız fitness ise hiçbir şey düşmez, yalnızca giriş-çıkış kaydedilir.
// Bu mantığı ikinci kez yazmak, "üye kaç hakkını kullandı" sorusunun iki cevabı demekti.
//
// İKİ ŞEY BİRLİKTE OLUYOR: kayıt (sunucuda, senkron) ve KOL (cihaza komut). Kayıt başarısızsa kol
// hiç dönmüyor — açılmış ama kaydedilmemiş bir kapı, doluluğu kalıcı olarak yanlış yapar.
//
// KOMUT CİHAZ BAŞINA TEK ve 20 saniyelik: `bekleyenAcma` ile aynı desen. Ekran artık üyenin adını
// ve kalan hakkını da gösteriyor — QR okutmakla panelden geçirmek arasında üye için hiçbir fark
// kalmıyor, ki owner'ın istediği tam olarak buydu.
export async function memberTurnstilePassAction(input: unknown) {
  const p = z.object({ memberId: z.string().min(1), direction: z.enum(['in', 'out']) }).parse(input)
  const ctx = await requireTenantContext(OPS)

  // O yöndeki cihaz. Cihaz yoksa kayıt yine geçerli: turnikesi olmayan bir stüdyoda da bu düğme
  // çalışmalı — ama o zaman bir KOL yok ve kayıt uyuşmazlığı eskisi gibi reddedilir.
  const cihaz = (await deps().repo.listDevices(ctx)).find((d) => d.active && (d as { side?: 'in' | 'out' }).side === p.direction)

  // 1 · KAYIT — QR yolunun kullandığı use-case'in aynısı, method'u dışında.
  const kayit = await recordCheckIn(deps(), ctx, {
    memberId: p.memberId as MemberId,
    branchId: (ctx.branchIds[0] ?? null) as BranchId,
    method: 'reception',
    occurredAt: instant(Date.now()),
    commandId: null,
    direction: p.direction,
    // Yön BİLİNÇLİ olarak bildiriliyor: resepsiyon düğmeye hangi yön için bastığını biliyor.
    directionAsserted: true,
    // Kol dönecekse, "zaten dışarıda/içeride" üyeyi kapıda bırakmaz (OR-75).
    atTurnstile: Boolean(cihaz),
  })
  if (!kayit.ok) return { ok: false as const, error: kayit.error }

  // 2 · KOL — o yöndeki cihaza komut.
  const member = await new FirestoreMemberRepository(adminDb()).findById(ctx, p.memberId as MemberId)
  const firstName = (member?.fullName ?? '').trim().split(/\s+/)[0] ?? ''
  const kalan = await kalanOzeti(ctx, p.memberId as MemberId)

  if (cihaz) {
    const res = await openTurnstileManually(deps(), ctx, cihaz.id, 'Resepsiyon panelden geçirdi')
    if (res.ok) {
      await adminDb()
        .doc(`studios/${ctx.studioId}/turnstileCommands/${cihaz.id}`)
        .set({ action: 'open', at: Date.now(), by: String(ctx.actor.id), reason: 'Resepsiyon panelden geçirdi', firstName, kalan })
    }
  }

  // Ekrana dönen özet: resepsiyon üyeye ne olduğunu SÖYLEYEBİLSİN. Turnike ekranındaki karşılama
  // ile aynı bilgi — iki yerde iki farklı sayı görmek, ikisine de güveni bitirir.
  return {
    ok: true as const,
    direction: kayit.value.direction,
    firstName,
    kalan,
    // Limitli fitnessten giriş düştüyse kaçta kaç olduğu. Düşmediyse null — ve düşmemesinin sebebi
    // ya dersi olması ya da sınırsız üyeliği.
    fitnessEntry: kayit.value.fitnessEntry,
    kolDondu: Boolean(cihaz),
  }
}

// ── AYRILAN YERDEKİ MİSAFİR TURNİKEDEN (owner, 2026-09-14 · OR-76) ─────────────────────────────
//
// *"yer ayırdığımız kişiler ... sistemde olmayabilir dolayısıyla qr okutamazlar ... buradan resepsiyon
// elle giriş - çıkışına izin versin ve olay kaydında bu kişiye ilişkilendirilsin."*
//
// Multisport misafirinin telefonunda uygulama yok, üye kaydı yok ve OLMAMALI. Resepsiyon, dersin
// ayrılan yerler listesindeki satırından geçirir. İki modül burada bağlanıyor, çekirdekte değil:
//   · GİRİŞ → önce `scheduling` misafiri GELDİ diye yazar (yalnızca seansın günü), SONRA kol açılır.
//     Kayıt reddedilirse kol dönmez: açılmış ama hesabı verilemeyen bir kapı olmasın.
//   · ÇIKIŞ → yalnızca kol. Gün sorulmaz, hiçbir şey reddedilmez: çıkış asla engellenmez (OR-53, OR-75).
//   · İki yönde de `turnstile.opened_manually` olayı `related`inde bu ayrılan yeri ve dersi taşır —
//     Hareket Merkezi'nde "kim için açıldı" sorusunun cevabı. İsim olayda YOK (I-13).
//
// Doluluğa girmez: misafir üye değil, `member.checked_in` yazılmaz (turnike geçişi ≠ üye girişi).
export async function seatHoldTurnstilePassAction(input: unknown) {
  const p = z.object({ holdId: z.string().min(1), direction: z.enum(['in', 'out']) }).parse(input)
  const ctx = await requireTenantContext(OPS)
  const scheduling = {
    repo: new FirestoreSchedulingRepository(adminDb()),
    clock: systemClock,
    studioConfig: DEFAULT_STUDIO_CONFIG,
    hours: new FirestoreStudioHours(adminDb()),
  }

  let classSessionId: string
  let arrivedNow = false
  if (p.direction === 'in') {
    const geldi = await recordGuestArrival(scheduling, ctx, p.holdId)
    if (!geldi.ok) return { ok: false as const, error: geldi.error }
    classSessionId = geldi.value.hold.classSessionId
    arrivedNow = geldi.value.arrivedNow
  } else {
    const hold = await getHold(scheduling, ctx, p.holdId)
    if (!hold) return { ok: false as const, error: { code: 'seat_hold_not_open' as const } }
    classSessionId = hold.classSessionId
  }

  const cihaz = (await deps().repo.listDevices(ctx)).find((d) => d.active && (d as { side?: 'in' | 'out' }).side === p.direction)
  if (!cihaz) return { ok: true as const, arrivedNow, kol: 'cihaz_yok' as const }

  const reason = p.direction === 'in' ? 'Ayrılan yerdeki misafir girişi' : 'Ayrılan yerdeki misafir çıkışı'
  const acildi = await openTurnstileManually(deps(), ctx, cihaz.id, reason, { classSessionId, seatHoldId: p.holdId })
  if (!acildi.ok) return { ok: true as const, arrivedNow, kol: 'acilamadi' as const }
  // Olay YAZILDIKTAN sonra komut — `openTurnstileAction` ile aynı sıra.
  await adminDb()
    .doc(`studios/${ctx.studioId}/turnstileCommands/${cihaz.id}`)
    .set({ action: 'open', at: Date.now(), by: String(ctx.actor.id), reason })
  return { ok: true as const, arrivedNow, kol: 'dondu' as const }
}
