'use server'

import { z } from 'zod'

import {
  FirestoreCheckinRepository,
  FirestoreEntitlementRepository,
  FirestoreReservationRepository,
  FirestoreStaffBreakRepository,
  FirestoreStaffShiftRepository,
  DEFAULT_STUDIO_CONFIG,
  addLocalDays,
  commitStaffCrossing,
  correctBreak,
  endBreak,
  endShift,
  enterBreakRetroactively,
  instant,
  instantFromLocalDate,
  localDateAt,
  mondayOf,
  prepareStaffCrossing,
  staffCrossTurnstile,
  startBreak,
  startShift,
  systemClock,
  type BranchId,
  type StaffUserId,
} from '@studio/core'

import { requireTenantContext } from '../auth'
import { adminDb } from '../firebase-admin'
import { openIfCodeLeftScreen } from '../turnstile-missed'
import { showRefusalOnScreen } from '../turnstile-refusal'

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

// ── ARA DİNLENMESİ (owner, 2026-10-06/07 · OR-119) ──────────────────────────────────────────
//
// Mola personelin KENDİ panelinden başlatılıp bitirilir — turnikeden değil (owner §10). Fiziksel
// giriş/çıkış ile mola iki ayrı kavram: kapıdan geçmek bir gözlem, molaya çıkmak bir karar.
//
// Aktör yine oturumun kendisi; `staffUserId` istemciden HİÇ alınmıyor. Vardiyada bu kuralın sebebi
// neyse molada da aynı: bir başkasının molasını yazabilen biri, onun çalışma süresini de yazar.
//
// Sayaç tarayıcıda dönüyor, buraya saniyede bir yazılmıyor (owner §11): sunucu yalnızca başlangıcı
// ve bitişi biliyor, aradaki her saniyeyi istemci `startedAt`ten hesaplıyor.
const molaDeps = () => ({ repo: new FirestoreStaffBreakRepository(adminDb()), clock: systemClock })

export async function startBreakAction() {
  const ctx = await requireTenantContext(HERKES)
  return startBreak(molaDeps(), new FirestoreStaffShiftRepository(adminDb()), ctx, {
    staffUserId: String(ctx.actor.id) as StaffUserId,
  })
}

export async function endBreakAction() {
  const ctx = await requireTenantContext(HERKES)
  return endBreak(molaDeps(), ctx, { staffUserId: String(ctx.actor.id) as StaffUserId })
}

// ── UNUTULAN MOLA VE MASADAN DÜZELTME (OR-119 · Faz 7) ──────────────────────────────────────
//
// İstemci SAAT gönderiyor ('HH:MM'), an değil: hangi günün o saati olduğunu ve stüdyonun saat
// dilimini sunucu biliyor. Tarayıcının kendi saat dilimiyle hesaplanmış bir an, başka bir ülkeden
// açılan bir telefonda molayı üç saat kaydırırdı.
const OFF = DEFAULT_STUDIO_CONFIG.utcOffsetMinutes
const SAAT = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)
const yerelAn = (date: string, hhmm: string): number => {
  const [sa, dk] = hhmm.split(':').map(Number) as [number, number]
  return (instantFromLocalDate(date, OFF) as number) + (sa * 60 + dk) * 60_000
}

/**
 * Molaya basmayı unutan personel eksik molasını KENDİSİ ekler — yalnızca bu hafta, pazartesiden
 * cumartesi gecesine kadar. Ekleme: kaydedilmiş bir molaya dokunmaz. Pencere, çakışma ve "vardiyanın
 * içinde mi" denetimi kararda (`decideEnterBreakRetroactively`); burada yalnızca saat ana çevriliyor.
 *
 * Saat VARDİYANIN başladığı güne yazılır; vardiya başlangıcından önceye düşüyorsa ertesi gündür
 * (gece yarısını geçen mesai). Bitiş başlangıçtan önceyse o da ertesi güne geçer.
 */
export async function enterBreakRetroAction(input: unknown) {
  const p = z.object({ shiftId: z.string().min(1).max(128), startTime: SAAT, endTime: SAAT }).safeParse(input)
  if (!p.success) return { ok: false as const, error: { code: 'invalid_time_range' as const } }
  const ctx = await requireTenantContext(HERKES)
  const db = adminDb()
  const vardiyaRepo = new FirestoreStaffShiftRepository(db)
  const ben = String(ctx.actor.id) as StaffUserId
  const pazartesi = mondayOf(localDateAt(instant(Date.now()), OFF) as string)
  const haftaBasi = instantFromLocalDate(pazartesi, OFF) as number
  const haftaSonu = instantFromLocalDate(addLocalDays(pazartesi, 7), OFF) as number
  // Vardiya istemcinin gönderdiği kimlikten değil, KENDİ haftamın vardiyaları arasından bulunuyor.
  const vardiya = (await vardiyaRepo.listShifts(ctx, haftaBasi, haftaSonu - 1)).find(
    (v) => v.id === p.data.shiftId && String(v.staffUserId) === String(ben),
  )
  if (!vardiya) return { ok: false as const, error: { code: 'no_open_shift' as const } }

  const gun = localDateAt(vardiya.startedAt, OFF) as string
  let bas = yerelAn(gun, p.data.startTime)
  if (bas < (vardiya.startedAt as number)) bas += 86_400_000
  let bit = yerelAn(gun, p.data.endTime)
  while (bit <= bas) bit += 86_400_000
  return enterBreakRetroactively(molaDeps(), vardiyaRepo, ctx, {
    staffUserId: ben,
    shiftId: vardiya.id,
    startedAt: instant(bas),
    endedAt: instant(bit),
  })
}

/**
 * Masadan mola düzeltmesi: patron ve resepsiyon, SEBEP ZORUNLU, öncesi ve sonrası kayda geçer.
 * Yetki ve sebep kararda (`decideCorrectBreak`). Açık kalmış bir mola da buradan kapatılır: bitiş
 * saati yazılır.
 *
 * Her saat, molanın o ucunun ZATEN bulunduğu yerel güne yazılır — düzeltme saati değiştirir, günü
 * değil. Açık bir molanın bitişi başlangıcının gününe yazılır.
 */
export async function correctBreakAction(input: unknown) {
  const p = z
    .object({
      breakId: z.string().min(1).max(128),
      startTime: SAAT,
      endTime: SAAT.nullable(),
      reason: z.string().trim().max(300),
    })
    .safeParse(input)
  if (!p.success) return { ok: false as const, error: { code: 'invalid_time_range' as const } }
  const ctx = await requireTenantContext(['owner', 'receptionist', 'platform_admin'])
  const deps = molaDeps()
  const mola = await deps.repo.getBreak(ctx, p.data.breakId)
  if (!mola) return { ok: false as const, error: { code: 'no_open_break' as const } }
  const basGun = localDateAt(mola.startedAt, OFF) as string
  const bitGun = mola.endedAt === null ? basGun : (localDateAt(mola.endedAt, OFF) as string)
  // DOKUNULMAYAN UÇ GÖNDERİLMİYOR. Ekran saati dakikaya yuvarlanmış gösteriyor; 13:00:37'de başlamış
  // bir molanın "13:00" yazan alanını olduğu gibi geri göndermek başlangıcı 37 saniye geri çeker ve
  // yalnızca bitişi düzelten biri, farkında olmadan başlangıcı da "düzeltmiş" olurdu.
  const yerelSaat = (at: number): string => {
    const dk = Math.floor((((at + OFF * 60_000) % 86_400_000) + 86_400_000) % 86_400_000 / 60_000)
    return `${String(Math.floor(dk / 60)).padStart(2, '0')}:${String(dk % 60).padStart(2, '0')}`
  }
  const basDegisti = p.data.startTime !== yerelSaat(mola.startedAt as number)
  const bitDegisti = p.data.endTime !== null && (mola.endedAt === null || p.data.endTime !== yerelSaat(mola.endedAt as number))
  return correctBreak(deps, ctx, {
    breakId: mola.id,
    ...(basDegisti ? { startedAt: instant(yerelAn(basGun, p.data.startTime)) } : {}),
    ...(bitDegisti ? { endedAt: instant(yerelAn(bitGun, p.data.endTime!)) } : {}),
    reason: p.data.reason,
  })
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
  if (!p.success) {
    // GÖRÜLEMEYEN ARIZA (owner, 2026-09-18 — Buse Hoca'nın çıkışı): burası "Bu bir turnike kodu değil"
    // diyip SESSİZCE dönüyordu. Ekranda hata vardı, sunucuda hiçbir iz yoktu; okunan şeyin ne olduğunu
    // kimse öğrenemedi ve arıza "bir kez oldu" diye geçiştirildi.
    //
    // Kodun KENDİSİ loglanmaz (kapıyı açan bir sırdır); loglanan şey ŞEKLİ: kaç karakter, rakam mı.
    // "14 karakter, rakam değil" cümlesi kamera bir URL okuduğunu söyler; "5 karakter" ise yarım okuma.
    const ham = typeof (input as { code?: unknown })?.code === 'string' ? ((input as { code: string }).code ?? '').trim() : ''
    console.warn('[turnstile] staff code rejected before server', {
      uzunluk: ham.length,
      sadeceRakam: /^\d*$/.test(ham),
      bosMu: ham.length === 0,
    })
    return { ok: false as const, error: { code: 'qr_invalid' as const } }
  }
  const ctx = await requireTenantContext(HERKES)
  const db = adminDb()
  const shiftDeps = deps()
  const r = await staffCrossTurnstile(
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
  // Kod ekrandan kalkmışsa cihaz geçişi görmez; kolu sunucudan aç (2026-09-14, `turnstile-missed.ts`).
  if (r.ok) await openIfCodeLeftScreen(ctx, r.value.deviceId, p.data.code)
  else {
    console.warn('[turnstile] staff crossing refused', { studioId: ctx.studioId, code: r.error.code })
    // Personelin reddi de ekranda görünür (2026-09-15) — "az önce geçtiniz" en çok mesai giriş/çıkışında olur.
    await showRefusalOnScreen(ctx, p.data.code, r.error.code)
  }
  return r
}
