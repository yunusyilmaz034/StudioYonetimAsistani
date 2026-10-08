import type { EntryRefusalReason } from '../events'

// ── KAPI: ELİNDE HAK KALDI MI? (owner, 2026-09-14 · OR-78) ─────────────────────────────────
//
// *"üyeliği olmayan, üyeliği biten kişi kapıda kalsın içeriye giremesin resepsiyona gitsin."* Bugüne kadar
// "biten" yalnızca TARİHİ dolan paketti. Dersleri tükenmiş ama tarihi dolmamış paket (8 dersin 8'i
// kullanılmış) ve limitli fitness giriş hakkı bitmiş paket kapıyı açıyordu — owner ikisini de kapatmayı seçti.
//
// SAF, ve aritmetik BURADA DEĞİL: kalan ders ve kalan giriş entitlements modülünün hesabından gelir. Aynı
// hesabı ikinci kez yazmak, "kaç hakkı kaldı" sorusunun iki cevabı demekti.

// ── DERS PAKETİ KAPIYI TEK BAŞINA AÇMAZ (owner, 2026-10-08 · OR-121) ───────────────────────
//
// *"Pilatesi var ama bugüne rezervasyonu yok, içeri girmiş. Pilates paketi alır, rezervasyon yapmaz,
// fitness'ı kullanabilir şu anda."* Ölçüldü: üye 11:45'te kendi QR'ıyla girdi, o güne dersi yoktu.
// Yukarıdaki kural "kalan dersi olan girer" diyordu — yani bir ders paketi, salonun süresiz anahtarıydı.
//
// Artık iki ayrı hak var. FITNESS hakkı (sınırsız, kalan giriş) DURAN bir haktır: üye istediği saatte
// gelir. DERS hakkı (pilates, PT) yalnızca bir DERSE aittir: kapıyı o dersin saati açar, paketin
// kendisi değil. "Bu saatte dersi var mı" bir okuma olduğu için burada sorulmuyor — bu fonksiyon
// `no_class_now` der, çağıran ret yolunda sorar (kapı, fitness üyesi için fazladan okuma yapmaz).

/** Tarihi bugün geçerli bir paketin kapı için özeti. İkisi de `null` ⇔ sınırsız paket. */
export interface EntryRight {
  /**
   * Paket yalnızca DERSE mi giriş verir — fitness dışındaki her kategori. Kategori duvarının kapıdaki
   * karşılığı: reformer paketi fitness salonunu açmaz.
   */
  readonly classOnly: boolean
  /** Kredili paket: kalan ders ve rezervasyonda tutulan ders. */
  readonly credits: { readonly remaining: number; readonly held: number } | null
  /** Limitli fitness: kalan giriş hakkı. */
  readonly entries: { readonly remaining: number } | null
}

const hakkiVar = (r: EntryRight): boolean =>
  (r.credits === null && r.entries === null) ||
  (r.credits !== null && r.credits.remaining + r.credits.held > 0) ||
  (r.entries !== null && r.entries.remaining > 0)

/**
 * Kapı neden hayır demeli — `null` ⇔ girebilir.
 *
 *   · Hiç geçerli paket yok → `no_active_membership`
 *   · FITNESS paketinde hak var (sınırsız, kalan giriş, kalan ders) → girer
 *   · Fitness hakkı yok ama bir DERS paketinde hak var → `no_class_now`: paketi sağlam, saati değil.
 *     Çağıran "bu saate dersi var mı" diye sorar ve varsa kapı açılır.
 *   · Hiçbir pakette hak yok → yalnızca giriş haklı paketleri varsa `no_entries_left`, aksi hâlde
 *     `no_credits_left`. (Bunlarda da derse gelen üye kapıda kalmaz — aynı soru, çağıranda.)
 */
export function entryRefusalReason(rights: readonly EntryRight[]): EntryRefusalReason | null {
  if (rights.length === 0) return 'no_active_membership'
  if (rights.some((r) => !r.classOnly && hakkiVar(r))) return null
  if (rights.some((r) => r.classOnly && hakkiVar(r))) return 'no_class_now'
  return rights.every((r) => r.entries !== null && r.credits === null) ? 'no_entries_left' : 'no_credits_left'
}
