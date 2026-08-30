// SOHBET LİSTESİNDE ZAMAN (owner, 2026-08-30).
//
// Dock yalnızca saati yazıyordu — `11:34`. Listede yan yana duran iki sohbetten hangisinin bu
// sabahtan, hangisinin geçen haftadan olduğu anlaşılmıyordu, ve resepsiyonun o listeye bakarken
// sorduğu ilk soru tam olarak bu: *taze mi?*
//
// Kural: yakın geçmiş GÜN adıyla, eskisi TARİHLE. Saat her ikisinde de var, çünkü aynı gün içinde
// sıralamayı okuyan şey o.
//
//   bugün / son 7 gün → "Paz 11:34"
//   daha eski         → "24.08 11:34"
//
// "Aynı hafta" yerine SON 7 GÜN kullanıldı: takvim haftası pazartesi sabahı tuhaflaşıyor — on iki
// saat önceki pazar mesajı bir anda "geçen hafta" olup tarihe düşüyor. Yedi gün, owner'ın istediği
// ayrımın aynısını verir ve o kenar durumu yaratmaz.

const TR = 'Europe/Istanbul'
const YEDI_GUN = 7 * 86_400_000

const saat = (d: Date) => d.toLocaleTimeString('tr-TR', { timeZone: TR, hour: '2-digit', minute: '2-digit' })

/** Sohbet satırının sağındaki zaman damgası. */
export function mesajZamani(ms: number, now: number = Date.now()): string {
  if (!Number.isFinite(ms) || ms <= 0) return ''
  const d = new Date(ms)
  // Gelecekteki bir damga (saat kayması, bozuk kayıt) "5 gün önce" diye okunmasın — saatle geç.
  if (ms > now) return saat(d)
  if (now - ms < YEDI_GUN) {
    const gun = d.toLocaleDateString('tr-TR', { timeZone: TR, weekday: 'short' })
    return `${gun} ${saat(d)}`
  }
  // Ayraç ELLE nokta. `toLocaleDateString` çalıştığı ortama göre `22/08` da `22.08` da üretebiliyor
  // — Node ile tarayıcı burada aynı fikirde değil. Türkçe'de tarih ayracı noktadır ve bu, yerelin
  // keyfine bırakılacak bir şey değil.
  const p = new Intl.DateTimeFormat('tr-TR', { timeZone: TR, day: '2-digit', month: '2-digit' }).formatToParts(d)
  const parca = (t: string) => p.find((x) => x.type === t)?.value ?? ''
  return `${parca('day')}.${parca('month')} ${saat(d)}`
}
