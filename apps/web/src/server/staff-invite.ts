import 'server-only'

import { createHash, randomBytes } from 'node:crypto'

import { adminAuth, adminDb } from './firebase-admin'

// PERSONEL DAVETİ — süresini BİZ belirleriz (owner, 2026-09-01).
//
// ── NEDEN YENİDEN YAZILDI ───────────────────────────────────────────────────────────────────
//
// İlk hâli Firebase'in `generatePasswordResetLink`'iydi. Owner linkleri dün gönderdi, üç hoca bugün
// girmeye kalktı ve linkler ölmüştü: Firebase'in şifre linki **bir saat** yaşar ve bu proje
// düzeyinde ayarlanabilir değil (Identity Toolkit config'inde böyle bir alan yok — bakıldı,
// varsayılmadı).
//
// WhatsApp'tan gönderilip ertesi gün açılacak bir davetin ömrü bir saat olamaz. Ve süresi dolan
// linke tıklayan hoca, Firebase'in İngilizce "try resetting your password again" sayfasını görüyordu
// — stüdyonun ekranı değil.
//
// ── TASARIM ─────────────────────────────────────────────────────────────────────────────────
//
// Üye davetinin (D1/D2) aynısı, personel için: ham jeton kenarda CSPRNG ile üretilir ve YALNIZCA
// linkte yaşar; veritabanında yalnızca SHA-256 özeti durur. Bir davet belgesini okuyan (ya da
// sızdıran) kimse, ondan bir link üretemez.
//
// Üç kural, üçü de üye davetiyle aynı sebeple:
//   · TEK KULLANIM — şifre belirlendiği anda tüketilir.
//   · SÜRE — 7 gün. Bir hafta, "yarın gelirim"i karşılar; sonsuz bir davet bir kapıdır.
//   · TEK CANLI DAVET — yeni davet üretmek eskisini geçersizleştirir. Aksi halde aylar önce
//     WhatsApp'ta kalmış bir link hâlâ çalışırdı.
//
// Pasif personele davet üretilmez ve tüketilmez: davet erişimdir, pasif meslektaş tam da erişmemesi
// gereken kişidir.

const GUN_MS = 86_400_000
export const STAFF_INVITE_TTL_DAYS = 7

const ozet = (token: string): string => createHash('sha256').update(token).digest('hex')

const col = (studioId: string) => adminDb().collection(`studios/${studioId}/staffInvites`)

export interface StaffInvite {
  readonly staffUserId: string
  readonly issuedAt: number
  readonly expiresAt: number
  readonly consumedAt: number | null
  readonly issuedBy: string
}

/**
 * Yeni davet üret: ham jetonu döndürür, veritabanına yalnızca özetini yazar.
 *
 * Eski canlı davetler aynı yazmada tüketilmiş sayılır — bir hesabın aynı anda iki geçerli daveti
 * olamaz, yoksa "yenisini gönderdim" eskisini kapatmaz.
 */
export async function issueStaffInvite(studioId: string, staffUserId: string, issuedBy: string): Promise<{ token: string; expiresAt: number }> {
  const token = randomBytes(32).toString('base64url')
  const now = Date.now()
  const expiresAt = now + STAFF_INVITE_TTL_DAYS * GUN_MS

  const eskiler = await col(studioId).where('staffUserId', '==', staffUserId).where('consumedAt', '==', null).get()
  const batch = adminDb().batch()
  for (const d of eskiler.docs) batch.update(d.ref, { consumedAt: now, supersededBy: 'reissue' })
  batch.set(col(studioId).doc(ozet(token)), {
    staffUserId,
    issuedAt: now,
    expiresAt,
    consumedAt: null,
    issuedBy,
  } satisfies StaffInvite)
  await batch.commit()

  return { token, expiresAt }
}

export type StaffInviteCheck =
  | { readonly ok: true; readonly displayName: string; readonly email: string }
  // TEK hata. Yanlış / süresi dolmuş / kullanılmış / bilinmeyen — hepsi aynı cevabı verir, çünkü
  // link deneyen birinin HANGİSİ olduğunu öğrenmesi, denemeye devam etmesi için bir ipucudur.
  // Üye davetinde de aynı kural (`invite_invalid`).
  | { readonly ok: false }

/** Davet geçerli mi — şifre belirleme ekranını açmadan önce. Hiçbir şeyi tüketmez. */
export async function checkStaffInvite(studioId: string, token: string): Promise<StaffInviteCheck> {
  const snap = await col(studioId).doc(ozet(token)).get()
  if (!snap.exists) return { ok: false }
  const inv = snap.data() as StaffInvite
  if (inv.consumedAt !== null || Date.now() > inv.expiresAt) return { ok: false }

  const staff = await adminDb().doc(`studios/${studioId}/staff/${inv.staffUserId}`).get()
  if (!staff.exists || staff.get('active') !== true) return { ok: false }
  const user = await adminAuth().getUser(inv.staffUserId).catch(() => null)
  if (!user?.email) return { ok: false }

  return { ok: true, displayName: String(staff.get('displayName') ?? ''), email: user.email }
}

/**
 * Şifreyi belirle ve daveti tüket.
 *
 * TÜKETME ÖNCE, şifre yazma SONRA olamaz (yarıda kalırsa hoca ne girer ne davet kalır); şifre önce,
 * tüketme sonra olamaz (yarıda kalırsa davet ikinci kez kullanılabilir). Bu yüzden tüketme
 * KOŞULLU bir işlem: yalnızca hâlâ tüketilmemişse tüket, kazanan tek olur, ve şifre ondan sonra
 * yazılır. İkinci istek yarışı kaybeder ve hiçbir şey yapmaz.
 */
export async function consumeStaffInvite(
  studioId: string,
  token: string,
  password: string,
): Promise<{ ok: true } | { ok: false; reason: 'invalid' | 'weak' }> {
  if (password.length < 8) return { ok: false, reason: 'weak' }

  const ref = col(studioId).doc(ozet(token))
  const kazanan = await adminDb().runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists) return null
    const inv = snap.data() as StaffInvite
    if (inv.consumedAt !== null || Date.now() > inv.expiresAt) return null
    tx.update(ref, { consumedAt: Date.now() })
    return inv.staffUserId
  })
  if (!kazanan) return { ok: false, reason: 'invalid' }

  const staff = await adminDb().doc(`studios/${studioId}/staff/${kazanan}`).get()
  if (!staff.exists || staff.get('active') !== true) return { ok: false, reason: 'invalid' }

  await adminAuth().updateUser(kazanan, { password })
  return { ok: true }
}
