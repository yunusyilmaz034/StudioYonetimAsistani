import { cookies } from 'next/headers'

import { maskEmail, maskName, maskPhone } from '@/lib/demo-mask'

// ── DEMO MODU — sunucu tarafı (owner, 2026-08-08) ────────────────────────────────────────────
//
// Maskeleme SUNUCUDA yapılır, ekranda değil. Tarayıcıya gerçek adı gönderip CSS ile bulanıklaştırmak
// maskeleme değildir — görüntü alınır, ama ağ sekmesinde, sayfa kaynağında ve React verisinde adlar
// olduğu gibi durur. Bir üyenin görmemesi gereken veri, telefonuna hiç gitmemeli (portal-query'nin
// arşivlenmiş programlar için verdiği kararın aynısı).
//
// ÇEREZDE, AYARLARDA DEĞİL. Panelin görünümü kişiye ait bir tercihtir, stüdyoya değil: sahibi demo
// modunu açtığında resepsiyonun ekranı değişmez. Ve hiçbir şey yazılmadığı için — ne veritabanına,
// ne olay kaydına — kapatmak, açmaktan daha kolaydır.

const COOKIE = 'demo_mask'

/** Bu isteği yapan kişi demo modunda mı? Yalnızca ONUN tarayıcısı için geçerli. */
export async function isDemoMode(): Promise<boolean> {
  return (await cookies()).get(COOKIE)?.value === '1'
}

/**
 * Bir kaydın kimliğe dair alanlarını maskeler. Diğer her şey — tarih, rakam, para, doluluk —
 * DOKUNULMADAN geçer: bir demo, uydurma sayılarla değil, gerçek bir işletmenin ritmiyle inandırıcı.
 *
 * `seed` genelde üye id'sidir; aynı üyenin her ekranda aynı takma adı almasını sağlar.
 */
export function maskRow<T extends { fullName?: string; phone?: string; email?: string }>(
  row: T,
  seed: string,
  on: boolean,
): T {
  if (!on) return row
  return {
    ...row,
    ...(row.fullName !== undefined ? { fullName: maskName(row.fullName, seed) } : {}),
    ...(row.phone !== undefined ? { phone: maskPhone(row.phone) } : {}),
    ...(row.email !== undefined ? { email: maskEmail(row.email) } : {}),
  }
}

/** Serbest metin içindeki bir ada denk gelen yeri takma adla değiştirir (aktivite satırları için). */
export function maskTextName(text: string, fullName: string, seed: string, on: boolean): string {
  if (!on || !fullName) return text
  return text.split(fullName).join(maskName(fullName, seed))
}
