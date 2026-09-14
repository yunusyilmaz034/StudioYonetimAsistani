import type { EntryRefusalReason } from '../events'

// ── KAPI: ELİNDE HAK KALDI MI? (owner, 2026-09-14 · OR-78) ─────────────────────────────────
//
// *"üyeliği olmayan, üyeliği biten kişi kapıda kalsın içeriye giremesin resepsiyona gitsin."* Bugüne kadar
// "biten" yalnızca TARİHİ dolan paketti. Dersleri tükenmiş ama tarihi dolmamış paket (8 dersin 8'i
// kullanılmış) ve limitli fitness giriş hakkı bitmiş paket kapıyı açıyordu — owner ikisini de kapatmayı seçti.
//
// SAF, ve aritmetik BURADA DEĞİL: kalan ders ve kalan giriş entitlements modülünün hesabından gelir. Aynı
// hesabı ikinci kez yazmak, "kaç hakkı kaldı" sorusunun iki cevabı demekti.

/** Tarihi bugün geçerli bir paketin kapı için özeti. İkisi de `null` ⇔ sınırsız paket. */
export interface EntryRight {
  /** Kredili paket: kalan ders ve rezervasyonda tutulan ders. */
  readonly credits: { readonly remaining: number; readonly held: number } | null
  /** Limitli fitness: kalan giriş hakkı. */
  readonly entries: { readonly remaining: number } | null
}

/**
 * Kapı neden hayır demeli — `null` ⇔ girebilir.
 *
 *   · Hiç geçerli paket yok → `no_active_membership`
 *   · Sınırsız paket, kalan ya da TUTULAN ders, kalan giriş hakkı → girer. Tutulan ders sayılır: bugüne
 *     rezervasyonu olan üyenin kalan dersi sıfır görünür ama o ders onundur.
 *   · Hiçbir pakette hak yok → yalnızca giriş haklı paketleri varsa `no_entries_left`, aksi hâlde
 *     `no_credits_left`.
 *
 * "O gün dersi var mı" burada SORULMAZ — o bir okuma, çağıran ret yolunda sorar.
 */
export function entryRefusalReason(rights: readonly EntryRight[]): EntryRefusalReason | null {
  if (rights.length === 0) return 'no_active_membership'
  const hakVar = rights.some(
    (r) =>
      (r.credits === null && r.entries === null) ||
      (r.credits !== null && r.credits.remaining + r.credits.held > 0) ||
      (r.entries !== null && r.entries.remaining > 0),
  )
  if (hakVar) return null
  return rights.every((r) => r.entries !== null && r.credits === null) ? 'no_entries_left' : 'no_credits_left'
}
