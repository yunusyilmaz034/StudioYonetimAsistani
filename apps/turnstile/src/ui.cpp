#include "ui.h"

#include <qrcode.h>

#include "tr_fonts.h"

// ── PALET ────────────────────────────────────────────────────────────────────────────────────
// Gradyan, gölge, çerçeve yok — 240×320'lik bir panelde süs, okunacak yerden çalar. Renkler
// RetroAsistan paletinden: koyu lacivert zemin, camgöbeği vurgu.
static const uint16_t ZEMIN = 0x0863;   // #0A0E1A — neredeyse siyah lacivert
static const uint16_t VURGU = 0x269D;   // #22D3EE — camgöbeği
static const uint16_t OLUMLU = 0x3693;  // #34D399 — yeşil
static const uint16_t OLUMSUZ = 0xFB8E; // #F87171 — kırmızı
static const uint16_t BEYAZ = 0xFFFF;
static const uint16_t SOLUK = 0x9517;   // #94A3B8 — küçük yazı

// ── YERLEŞİM (240×320, hepsi ölçülü) ─────────────────────────────────────────────────────────
// Panel 224×224 → x 8..232, y 38..262. QR 21 modül × 8 px = 168 px, panelin ortasında; kalan
// 28 px sessiz bölge, yani 3,5 modül.
//
// SESSİZ BÖLGE PAZARLIĞI (owner'a rapor edilecek): standart 4 modül ister, ekran 240 px geniş ve
// 21+8=29 modül 240'a 8 px'lik modülle sığmıyor. Üç seçenekten:
//   · modül 9 → QR 189 px (istenen 190'a en yakın) ama sessiz bölge 2,8 modül,
//   · modül 8 + tam kenar → QR 168 px, sessiz bölge 4 modül, ama köşe işaretlerine yer kalmıyor,
//   · modül 8 + 3,5 modül sessiz bölge → QR 168 px, köşe işaretleri zeminde. ← seçilen
// QR okunurluğu birinci öncelik, ve okunurluğu asıl belirleyen modül başına düşen piksel: eski
// sürüm sürüm-3 (29 modül) kullanıyordu ve modül 6 px'ti. Şimdi 8 px — %33 daha iri. İstenen
// 190 px'e çıkmak, QR'ı büyütüp okunmasını zorlaştırmak olurdu.
static const int16_t PANEL_X = 8, PANEL_Y = 38, PANEL = 224;
static const int16_t QR_MODUL = 8;

static int16_t genislik(Adafruit_ILI9341& tft, const GFXfont* f, const char* s) {
  int16_t x1, y1; uint16_t w, h;
  tft.setFont(f);
  tft.getTextBounds(s, 0, 0, &x1, &y1, &w, &h);
  return (int16_t)w;
}

/** Yatayda ortalanmış tek satır. `y` YAZININ TABANI (custom font'ta imleç tabandadır). */
static void ortala(Adafruit_ILI9341& tft, const GFXfont* f, uint16_t renk, int16_t y, const char* s) {
  int16_t x1, y1; uint16_t w, h;
  tft.setFont(f);
  tft.getTextBounds(s, 0, y, &x1, &y1, &w, &h);
  tft.setTextColor(renk);
  tft.setCursor((240 - (int16_t)w) / 2 - (x1 - 0), y);
  tft.print(s);
}

static void ortala(Adafruit_ILI9341& tft, const GFXfont* f, uint16_t renk, int16_t y, const String& s) {
  ortala(tft, f, renk, y, s.c_str());
}

/**
 * Sığan en büyük font. Uzun isim küçültülür, kesilmez — kapıda kendi adını yarım gören biri
 * sistemin onu tanımadığını düşünür.
 */
static const GFXfont* enBuyuk(Adafruit_ILI9341& tft, const char* s, int16_t maks) {
  if (genislik(tft, &TrSans18, s) <= maks) return &TrSans18;
  if (genislik(tft, &TrSans11, s) <= maks) return &TrSans11;
  return &TrSans9;
}

/**
 * Üye adı: önce tek satırda en büyük fontla, sığmazsa boşluktan iki satıra. İki satır da
 * sığmazsa 9 punto tek satır — o boyda 240 px'e sığmayan bir ada bu stüdyoda rastlanmadı.
 * `y` ilk satırın tabanı; dönen değer kullanılan son satırın tabanı.
 */
static int16_t adCiz(Adafruit_ILI9341& tft, const String& ad, int16_t y) {
  if (!ad.length()) return y;
  const int16_t maks = 224;
  if (genislik(tft, &TrSans18, ad.c_str()) <= maks) { ortala(tft, &TrSans18, BEYAZ, y, ad.c_str()); return y; }

  const int bosluk = ad.lastIndexOf(' ');
  if (bosluk > 0) {
    const String ust = ad.substring(0, bosluk), alt = ad.substring(bosluk + 1);
    const GFXfont* f = (genislik(tft, &TrSans18, ust.c_str()) <= maks &&
                        genislik(tft, &TrSans18, alt.c_str()) <= maks) ? &TrSans18 : &TrSans11;
    if (genislik(tft, f, ust.c_str()) <= maks && genislik(tft, f, alt.c_str()) <= maks) {
      const int16_t adim = (f == &TrSans18) ? 38 : 26;
      ortala(tft, f, BEYAZ, y, ust.c_str());
      ortala(tft, f, BEYAZ, y + adim, alt.c_str());
      return y + adim;
    }
  }
  ortala(tft, enBuyuk(tft, ad.c_str(), maks), BEYAZ, y, ad.c_str());
  return y;
}

/** Kalın çizgi — GFX'in `drawLine`'ı 1 px, ikon o kalınlıkta uzaktan görünmüyor. */
static void kalinCizgi(Adafruit_ILI9341& tft, int x0, int y0, int x1, int y1, int kalinlik, uint16_t renk) {
  for (int i = -kalinlik / 2; i <= kalinlik / 2; i++) {
    tft.writeLine(x0 + i, y0, x1 + i, y1, renk);
    tft.writeLine(x0, y0 + i, x1, y1 + i, renk);
  }
}

static void ikonOnay(Adafruit_ILI9341& tft, int cx, int cy) {
  tft.startWrite();
  kalinCizgi(tft, cx - 30, cy + 2, cx - 10, cy + 24, 7, OLUMLU);
  kalinCizgi(tft, cx - 10, cy + 24, cx + 32, cy - 24, 7, OLUMLU);
  tft.endWrite();
}

static void ikonHata(Adafruit_ILI9341& tft, int cx, int cy) {
  tft.startWrite();
  kalinCizgi(tft, cx - 26, cy - 26, cx + 26, cy + 26, 7, OLUMSUZ);
  kalinCizgi(tft, cx + 26, cy - 26, cx - 26, cy + 26, 7, OLUMSUZ);
  tft.endWrite();
}

/** Panelin dört köşesine oturan camgöbeği tarayıcı köşeleri — tam çerçeve değil. */
static void koseler(Adafruit_ILI9341& tft) {
  const int16_t d = 3, k = 4, u = 30;  // panele uzaklık, kalınlık, kol uzunluğu
  const int16_t sol = PANEL_X - d - k, sag = PANEL_X + PANEL + d;
  const int16_t ust = PANEL_Y - d - k, alt = PANEL_Y + PANEL + d;
  tft.startWrite();
  for (int yatay = 0; yatay < 2; yatay++) {
    for (int dikey = 0; dikey < 2; dikey++) {
      const int16_t x = yatay ? sag : sol, y = dikey ? alt : ust;
      tft.writeFillRect(yatay ? x - u + k : x, y, u, k, VURGU);
      tft.writeFillRect(x, dikey ? y - u + k : y, k, u, VURGU);
    }
  }
  tft.endWrite();
}

String tr(const String& s) {
  String o;
  for (size_t i = 0; i < s.length(); i++) {
    const uint8_t c = (uint8_t)s[i];
    if (c < 0x80) { o += (char)c; continue; }
    if (i + 1 >= s.length()) break;
    const uint8_t d = (uint8_t)s[++i];
    const uint16_t cp = ((c & 0x1F) << 6) | (d & 0x3F);
    switch (cp) {
      case 0x011E: o += (char)0xC0; break;  // Ğ
      case 0x011F: o += (char)0xE0; break;  // ğ
      case 0x0130: o += (char)0xCC; break;  // İ
      case 0x0131: o += (char)0xEC; break;  // ı
      case 0x015E: o += (char)0xDE; break;  // Ş
      case 0x015F: o += (char)0xFE; break;  // ş
      default: if (cp <= 0xFF) o += (char)cp; break;  // ç Ç ö Ö ü Ü doğrudan Latin-1'de
    }
  }
  return o;
}

/** Karanlık zemin. Beyaz QR paneli duruyorsa tam ekran, durmuyorsa yalnızca yazı alanı. */
static void zemin(Yuz& y) {
  Adafruit_ILI9341& tft = *y.tft;
  tft.startWrite();
  if (y.ekran == Ekran::Hazir || y.ekran == Ekran::Kontrol || y.ekran == Ekran::Yok)
    tft.writeFillRect(0, 0, 240, 320, ZEMIN);
  else
    tft.writeFillRect(0, 40, 240, 280, ZEMIN);
  tft.endWrite();
}

void uiBaglaniyor(Yuz& y) {
  Adafruit_ILI9341& tft = *y.tft;
  zemin(y);
  // TEKNİK BİLGİ YOK (owner şartı): IP, SSID, HTTP kodu, istisna — hiçbiri. Kapıdaki üye için
  // "Bağlantı kuruluyor" bilgidir, "192.168.1.42 / WL_DISCONNECTED" gürültüdür. Teşhis seri
  // porta ve sunucu loguna gidiyor; ekran müşteriye ait.
  ortala(tft, &TrSans11, BEYAZ, 160, tr("Bağlantı kuruluyor..."));
  ortala(tft, &TrSans9, SOLUK, 192, tr("Lütfen bekleyin"));
  y.ekran = Ekran::Baglaniyor;
  y.kod = "";
}

void uiHazir(Yuz& y, const String& kod) {
  Adafruit_ILI9341& tft = *y.tft;
  // AYNI KOD YENİDEN ÇİZİLMEZ. 2 MHz'lik veri yolunda tam ekran ~0,6 s sürüyor; her turda çizmek
  // ekranı sürekli titretir ve QR'ı okunmaz yapardı.
  if (y.ekran == Ekran::Hazir && y.kod == kod) return;
  const bool tamZemin = y.ekran != Ekran::Hazir && y.ekran != Ekran::Kontrol;

  QRCode qr;
  uint8_t veri[qrcode_getBufferSize(3)];
  // Sürüm 1 (21 modül) 6 haneli koda fazlasıyla yeter ve modülü irileştirir. Kod beklenmedik
  // biçimde uzarsa kütüphane hata döner; o zaman eski sürüm-3'e düşüyoruz — QR'sız kalmaktansa.
  uint8_t surum = 1;
  if (qrcode_initText(&qr, veri, 1, ECC_MEDIUM, kod.c_str()) != 0) {
    surum = 3;
    qrcode_initText(&qr, veri, 3, ECC_MEDIUM, kod.c_str());
  }
  const int16_t modul = (surum == 1) ? QR_MODUL : (PANEL - 16) / qr.size;
  const int16_t kenar = PANEL_X + (PANEL - qr.size * modul) / 2;
  const int16_t ust = PANEL_Y + (PANEL - qr.size * modul) / 2;

  tft.startWrite();
  if (tamZemin) tft.writeFillRect(0, 0, 240, 320, ZEMIN);
  else tft.writeFillRect(0, 264, 240, 56, ZEMIN);  // "Kontrol ediliyor" şeridini sil
  tft.writeFillRect(PANEL_X, PANEL_Y, PANEL, PANEL, BEYAZ);
  for (uint8_t qy = 0; qy < qr.size; qy++)
    for (uint8_t qx = 0; qx < qr.size; qx++)
      if (qrcode_getModule(&qr, qx, qy))
        tft.writeFillRect(kenar + qx * modul, ust + qy * modul, modul, modul, ILI9341_BLACK);
  tft.endWrite();

  if (tamZemin) {
    koseler(tft);
    // Yön yazısı: üye hangi taraftan geçeceğini kapıya VARMADAN bilmeli (owner, 2026-08-29).
    ortala(tft, &TrSans9, VURGU, 22, y.mod == Mod::Giris ? tr("GİRİŞ") : tr("ÇIKIŞ"));
  }
  ortala(tft, &TrSans11, BEYAZ, 292, tr("QR Kodunuzu Okutun"));
  ortala(tft, &TrSans9, SOLUK, 314, y.mod == Mod::Giris ? tr("Giriş için hazır") : tr("Çıkış için hazır"));
  y.ekran = Ekran::Hazir;
  y.kod = kod;
}

void uiKontrol(Yuz& y) {
  Adafruit_ILI9341& tft = *y.tft;
  // QR YERİNDE KALIYOR, yalnızca alt şerit değişiyor: tam ekran çizmek 0,6 s sürer ve o gecikme
  // tam da "sistem cevap veriyor" hissini vermek istediğimiz saniyeye düşerdi.
  tft.startWrite();
  tft.writeFillRect(0, 264, 240, 56, ZEMIN);
  tft.endWrite();
  ortala(tft, &TrSans11, VURGU, 300, tr("Kontrol ediliyor..."));
  y.ekran = Ekran::Kontrol;
}

void uiBasarili(Yuz& y, const String& ad, const String& kalan) {
  Adafruit_ILI9341& tft = *y.tft;
  zemin(y);
  ikonOnay(tft, 120, 86);
  const bool giris = y.mod == Mod::Giris;
  ortala(tft, &TrSans18, OLUMLU, 176, giris ? tr("Hoş Geldiniz") : tr("Güle Güle"));
  const int16_t son = adCiz(tft, tr(ad), 218);
  // Kalan hak: üyenin kapıda sorduğu tek soru. Yoksa satır hiç çizilmiyor — boş bir "kalan:"
  // yazısı, bilgi vermemekten kötüdür.
  if (kalan.length()) ortala(tft, &TrSans9, VURGU, min(son + 30, 288), tr(kalan));
  ortala(tft, &TrSans9, SOLUK, 306, giris ? tr("Girişiniz onaylandı") : tr("Çıkışınız tamamlandı"));
  y.ekran = Ekran::Basarili;
  y.kod = "";
}

/**
 * Alt açıklama: sığmıyorsa son boşluktan iki satır. Metni kısaltmak yerine bölüyoruz —
 * "Lütfen resepsiyona uğrayın" 9 puntoda tam 240 px, yani ekranın kenarına yapışıyordu.
 */
static int16_t altYaz(Adafruit_ILI9341& tft, const char* s, int16_t y) {
  if (genislik(tft, &TrSans9, s) <= 224) { ortala(tft, &TrSans9, SOLUK, y, s); return y; }
  const String t(s);
  const int b = t.lastIndexOf(' ');
  if (b <= 0) { ortala(tft, &TrSans9, SOLUK, y, s); return y; }
  ortala(tft, &TrSans9, SOLUK, y, t.substring(0, b));
  ortala(tft, &TrSans9, SOLUK, y + 20, t.substring(b + 1));
  return y + 20;
}

void uiReddedildi(Yuz& y, const char* baslik, const char* alt) {
  Adafruit_ILI9341& tft = *y.tft;
  zemin(y);
  ikonHata(tft, 120, 96);
  ortala(tft, enBuyuk(tft, baslik, 224), OLUMSUZ, 190, baslik);
  altYaz(tft, alt, 228);
  y.ekran = Ekran::Reddedildi;
  y.kod = "";
}
