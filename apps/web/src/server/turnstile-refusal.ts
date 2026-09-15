import 'server-only'

import type { TenantContext } from '@studio/core'

import { adminDb } from './firebase-admin'

// ── RET EKRANA DA GİDER (owner, 2026-09-15) ──────────────────────────────────────────────────
//
// Bir ret kodu HARCAMAZ, ve ekran geçişleri "kodum kullanıldı mı?" diye sorarak öğreniyor — harcanmamış
// bir kod, ekran için hiç olmamış bir okutmadır. Bu yüzden cihaz başına tek bir "son ret" kaydı var
// (`sonRet` okur ve siler).
//
// 2026-08-31'den beri yalnızca `no_active_membership` yazılıyordu. 15 Eylül sabahı owner giriş QR'ını
// çıkıştan 39 sn sonra okuttu: `checkin_too_soon`, ekran HİÇBİR ŞEY yapmadı, turnike bozuk sanıldı.
// OR-78'in "dersi/giriş hakkı bitti" retleri de aynı sessizlikteydi. Aşağıdaki liste ekranda anlamı olan
// retlerdir; `qr_used` / `qr_expired` BİLEREK yok — telefonun kamerası başarılı bir geçişten sonra aynı
// kodu tekrar okuyabiliyor ve karşılamanın üstüne "yapılamadı" yazmak yalan olurdu.
export const SCREEN_REFUSALS = ['no_active_membership', 'no_credits_left', 'no_entries_left', 'checkin_too_soon'] as const

export async function showRefusalOnScreen(ctx: TenantContext, code: string, reason: string, firstName = ''): Promise<void> {
  if (!(SCREEN_REFUSALS as readonly string[]).includes(reason)) return
  const snap = await adminDb().doc(`studios/${ctx.studioId}/turnstileCodes/${code}`).get()
  const deviceId = snap.exists ? String(snap.get('deviceId') ?? '') : ''
  if (!deviceId) return
  await adminDb()
    .doc(`studios/${ctx.studioId}/turnstileRefusals/${deviceId}`)
    // Ad, karşılamada olduğu gibi yalnızca ilk isim: koridorda yabancılar geçiyor. Cihaz bugün ret
    // ekranında adı hiç yazmıyor (kalabalıkta teşhir) — alan geriye uyum için duruyor.
    .set({ firstName, reason, at: Date.now() })
}
