import 'server-only'

import type { DeviceId, TenantContext } from '@studio/core'
import { Timestamp } from 'firebase-admin/firestore'

import { adminDb } from './firebase-admin'

// ── "HOŞ GELDİN DEDİ, KOL DÖNMEDİ" (owner, 2026-09-14) ──────────────────────────────────────
//
// Cihaz ekrandaki kodu 25 saniyede bir yeniliyor ve YALNIZCA o anki kodu soruyor ("kullanıldı mı?").
// Sunucu ise bir kodu 45 saniye geçerli sayıyor. Ekrandan az önce kalkmış bir kod okutulursa geçiş kabul
// edilir — telefon "hoş geldin" der, giriş yazılır — ama cihaz o kodu artık sormadığı için kola hiç darbe
// gitmez. Bugün iki kez oldu (12:47, 15:00; kod yaşları 25 ve 28 sn).
//
// FIRMWARE'E DOKUNMADAN çözüm: cihazın her turda zaten okuduğu tek-komut kaydına (`turnstileCommands`,
// resepsiyonun elle açmasıyla aynı yol) bir AÇ bırakmak. İki ayrı anda sorulur, çünkü kaçırma iki şekilde olur:
//
//   1. GEÇİŞ ANINDA — okutulan kod artık ekranda değilse (`device.currentCode` başka): cihaz yeni koda geçmiş.
//   2. KOD YENİLENİRKEN — ekrandan kalkan kod kullanılmış ama cihaz onu hiç GÖRMEMİŞSE (`seenAt` yok): kod,
//      cihazın son sorusuyla yenileme isteği arasında kullanılmış.
//
// ÇİFT DARBE YOK: firmware bir kapı için sırayla çalışıyor — önce "kodum kullanıldı mı", sonra gerekirse yeni
// kod. Yeni kod istendiğinde eski kod bir daha sorulmaz; ikisi aynı geçiş için birlikte tetiklenemez.

const komut = (ctx: TenantContext, deviceId: DeviceId, reason: string) =>
  adminDb()
    .doc(`studios/${ctx.studioId}/turnstileCommands/${deviceId}`)
    .set({ action: 'open', at: Date.now(), by: 'system', reason })

/** (1) Geçiş başarıyla yazıldıktan sonra: cihaz bu kodu hâlâ gösteriyor mu? Göstermiyorsa kolu aç. */
export async function openIfCodeLeftScreen(ctx: TenantContext, deviceId: DeviceId, code: string): Promise<void> {
  try {
    const snap = await adminDb().doc(`studios/${ctx.studioId}/devices/${deviceId}`).get()
    const ekrandaki = snap.get('currentCode') as string | null | undefined
    if (!ekrandaki || ekrandaki === code) return
    await komut(ctx, deviceId, 'Ekrandan kalkmış kodla geçiş — kol sunucudan açıldı')
    console.warn('[turnstile] crossing on a code no longer on screen; opened by command', {
      studioId: ctx.studioId,
      deviceId,
    })
  } catch (e) {
    // Geçiş zaten yazıldı; bu bir kurtarma denemesi. Sessiz değil, ama geçişi de düşürmez.
    console.error('[turnstile] missed-code recovery (crossing) failed', e)
  }
}

/** (2) Cihaz yeni kod istemeden ÖNCE ekranda olan kod: kullanılmış ama görülmemişse kolu aç. */
export async function openIfPreviousCodeUnseen(ctx: TenantContext, deviceId: DeviceId, previousCode: string | null | undefined): Promise<void> {
  if (!previousCode) return
  try {
    const snap = await adminDb().doc(`studios/${ctx.studioId}/turnstileCodes/${previousCode}`).get()
    if (!snap.exists || !snap.get('usedAt') || snap.get('seenAt')) return
    await komut(ctx, deviceId, 'Cihazın görmediği geçiş — kol sunucudan açıldı')
    console.warn('[turnstile] crossing unseen before code refresh; opened by command', { studioId: ctx.studioId, deviceId })
  } catch (e) {
    console.error('[turnstile] missed-code recovery (refresh) failed', e)
  }
}

/**
 * Cihaz bir geçişi GÖRDÜ: koda damga + gecikme logu. Enstrüman bu — "telefon onayladı" ile "kol açıldı" arası
 * artık tahmin değil ölçüm. Yalnızca ilk görüşte yazılır.
 */
export async function markCrossingSeen(ctx: TenantContext, code: string, usedAt: number): Promise<void> {
  try {
    const ref = adminDb().doc(`studios/${ctx.studioId}/turnstileCodes/${code}`)
    const snap = await ref.get()
    if (snap.get('seenAt')) return
    const now = Date.now()
    await ref.update({ seenAt: Timestamp.fromMillis(now) })
    console.info('[turnstile] crossing seen by device', { studioId: ctx.studioId, latencyMs: now - usedAt })
  } catch (e) {
    console.error('[turnstile] could not stamp seenAt', e)
  }
}
