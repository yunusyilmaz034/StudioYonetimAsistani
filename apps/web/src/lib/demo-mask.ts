// ── DEMO MODU (owner, 2026-08-08) ────────────────────────────────────────────────────────────
//
// Panelin ekran görüntüsünü almak ya da yeni bir müşteriye canlı demo göstermek gerektiğinde,
// Işıl'ın üyelerinin adı ve telefonu ekranda görünmemeli. Onlar bu stüdyonun verisi değil,
// ÜYELERİN verisi — işletme sahibi olmak, üyenin adını pazarlama malzemesi yapma hakkı vermiyor.
//
// ÜÇ ŞEY BU MODUN YAPMADIĞI, ve üçü de kasıtlı:
//
//   1. HİÇBİR ŞEY YAZMAZ. Ne veritabanına, ne olay kaydına, ne ayarlara. Yalnızca ekrana giden
//      metni değiştirir. Kapatıldığında her şey aynen geri gelir, çünkü zaten hiç gitmemiştir.
//   2. OTURUMA ÖZELDİR. Bir çerezde durur, `settings` belgesinde değil — bu yüzden sahibi açtığında
//      resepsiyonun ekranı etkilenmez. Panelin görünümü kişiye ait bir tercihtir, stüdyoya değil.
//   3. GERÇEK VERİYİ SİLMEZ. Rakamlar, tarihler, doluluk, para — hepsi doğru kalır. Bir demo,
//      uydurma sayılarla değil, gerçek bir işletmenin ritmiyle inandırıcıdır.
//
// Maskeleme DETERMİNİSTİKTİR: aynı üye her ekranda aynı takma adı alır. Rastgele olsaydı, aynı
// kişi takvimde "Ayşe K." rezervasyonlarda "Zeynep D." görünür ve demo tutarsızlaşırdı.

/** Basit, kararlı bir karma — kriptografik değil, sadece aynı girdiye aynı çıktıyı vermek için. */
function hash(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

// Türkçe, stüdyonun müşteri profiline uygun ve GERÇEK ÜYELERLE ÇAKIŞMASI ÖNEMSİZ isimler: takma ad
// zaten gerçek kişiye ait değil, sadece ekranın dolu görünmesini sağlıyor.
const FIRST = [
  'Ayşe', 'Zeynep', 'Elif', 'Merve', 'Fatma', 'Büşra', 'Seda', 'Gamze', 'Ece', 'Deniz',
  'Selin', 'Burcu', 'Nur', 'Melis', 'Ceren', 'Esra', 'Duygu', 'Pınar', 'Yasemin', 'Damla',
]
const LAST_INITIAL = ['A.', 'B.', 'C.', 'D.', 'E.', 'G.', 'K.', 'M.', 'Ö.', 'S.', 'T.', 'Y.']

/**
 * Bir üyenin adını takma adla değiştirir: "SAKİNE GÜMÜŞ" → "Ayşe K."
 *
 * Soyadı tamamen düşer, ad da değişir — baş harfi korumak, küçük bir stüdyoda kimliği açık etmeye
 * yeter ("S. G." kim olabilir sorusunun cevabı kısa bir listedir).
 */
export function maskName(fullName: string, seed: string): string {
  const h = hash(seed || fullName)
  return `${FIRST[h % FIRST.length]} ${LAST_INITIAL[(h >> 5) % LAST_INITIAL.length]}`
}

/**
 * Telefonu maskeler, son iki hanesi kalır: "+905455714147" → "+90 5•• ••• •• 47"
 *
 * Son iki hane, resepsiyonun demo sırasında "bu kayıt hangisiydi" diye ayırt edebilmesi için
 * bırakılır; iki hane tek başına kimseyi bulmaya yetmez.
 */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  if (digits.length < 4) return '+90 5•• ••• •• ••'
  return `+90 5•• ••• •• ${digits.slice(-2)}`
}

/** E-posta: "ayse@gmail.com" → "a•••@gmail.com". Alan adı kalır, kim olduğu gitmiş olur. */
export function maskEmail(email: string): string {
  const at = email.indexOf('@')
  if (at <= 0) return '•••'
  return `${email[0]}•••${email.slice(at)}`
}
