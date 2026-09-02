// TÜRKÇE ARAMA KATLAMASI — bir yerde, bir kez (owner, 2026-09-02).
//
// ── NE OLDU ─────────────────────────────────────────────────────────────────────────────────
//
// Owner ⌘K'ya "ebru kılıç" yazdı, üye "EBRU KILIÇ" olarak kayıtlıydı, arama "Sonuç yok" dedi.
// Sebep tek satırlık ve sinsi:
//
//     "EBRU KILIÇ".toLowerCase()  →  "ebru kiliç"     ← noktalı i
//     kullanıcının yazdığı        →  "ebru kılıç"     ← noktasız ı
//
// Türkçede `I`nin küçüğü `ı`dır, `i` değil. `toLowerCase()` bunu bilmez; `toLocaleLowerCase('tr')`
// bilir. Ama o da yetmez, çünkü resepsiyon telefonla konuşurken aksan yazmıyor: "gulnare" yazan biri
// "GÜLNARE"yi bulamıyordu.
//
// ── NEDEN TEK FONKSİYON ────────────────────────────────────────────────────────────────────
//
// Aynı katlama panelde on iki yerde tekrarlanıyordu ve her biri kendi başına doğruydu — ta ki biri
// unutulana kadar. Arama kutusunun bulduğu ile listenin bulduğu farklıysa, kullanıcı ikisine de
// güvenmeyi bırakır. Bir üye bir ekranda bulunup ötekinde bulunmuyorsa, sorun ekranda değil
// kuralın iki kez yazılmış olmasındadır.

const HARFLER: Readonly<Record<string, string>> = {
  İ: 'i', I: 'i', ı: 'i', i: 'i',
  Ş: 's', ş: 's',
  Ğ: 'g', ğ: 'g',
  Ü: 'u', ü: 'u',
  Ö: 'o', ö: 'o',
  Ç: 'c', ç: 'c',
  Â: 'a', â: 'a', Î: 'i', î: 'i', Û: 'u', û: 'u',
}

/**
 * Aramada karşılaştırılabilir hâle getir: Türkçe küçültme **ve** aksan düşürme.
 *
 * `İ · I · ı · i` hepsi `i` olur — hangi yönde yazıldığı önemsiz. `ş→s · ğ→g · ü→u · ö→o · ç→c`,
 * yani "gulnare" "GÜLNARE"yi, "kilic" "KILIÇ"ı bulur. Sorgu ve değer **aynı** fonksiyondan geçmeli;
 * yalnızca birini katlamak, hatayı yönü değişmiş hâlde geri getirir.
 */
export function foldTr(s: string): string {
  let out = ''
  for (const ch of s) out += HARFLER[ch] ?? ch
  return out.toLowerCase()
}
