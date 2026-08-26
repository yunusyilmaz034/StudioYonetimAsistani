// AŞAMA 3 — RÖLE
//
// Akış: ekranda kod → üye okutur → sunucu geçişi kaydeder → cihaz sorar "kodum kullanıldı mı" →
// kullanıldıysa röle darbesi + karşılama.
//
// Karar burada verilmiyor, HABER buraya geliyor. Kimin geçebileceğine, kredinin düşüp
// düşmeyeceğine, yönün ne olduğuna sunucu karar verdi; bu kutu sadece kolu tetikliyor. Duvara
// vidalanmış bir kutunun bildiği hiçbir şeye güvenilmez.
//
// RÖLE AKTİF-LOW ve açık-kollektör sürülüyor: tetiklemek için pini toprağa çekiyoruz, bırakmak
// için YÜKSEK yapmıyoruz — girişi yüksek empedansa alıyoruz. Röle kartı 5V'la, ESP32 3.3V'la
// çalıştığı için 3.3V "yüksek" optokuplörü tam söndürmeyebilir; hiç sürmemek bu sorunu ortadan
// kaldırıyor.
#include <Adafruit_GFX.h>
#include <Adafruit_ILI9341.h>
#include <HTTPClient.h>
#include <SPI.h>
#include <WiFi.h>
#include <qrcode.h>

#include "secrets.h"

static const int PIN_SCK = 12;
static const int PIN_MOSI = 11;
static const int PIN_DC = 13;
static const int PIN_RST = 8;
static const int PIN_CS = 10;
static const int PIN_LED = 18;
static const int PIN_ROLE_GIRIS = 5;   // In1 — besleme çözülünce buraya dönülecek
static const int PIN_ROLE_CIKIS = 4;   // In2

// Turnike kendi süresini sayıyor (F01), bize sadece tetiklemek düşüyor.
static const uint32_t DARBE_MS = 300;
static const uint32_t SORGU_MS = 600;      // "kodum kullanıldı mı"
static const uint32_t KARSILAMA_MS = 3000; // ekranda ismin kaldığı süre

static Adafruit_ILI9341 tft(PIN_CS, PIN_DC, PIN_RST);
static String aktifKod = "";
static uint32_t kodBitis = 0;

/** Türkçe harfler Adafruit fontunda yok; ismi tanınır halde bırakan en yakın karşılık. */
static String asciile(const String& s) {
  String o;
  for (size_t i = 0; i < s.length(); i++) {
    const uint8_t c = (uint8_t)s[i];
    if (c < 0x80) { o += (char)c; continue; }
    if (i + 1 >= s.length()) break;
    const uint8_t d = (uint8_t)s[++i];
    if (c == 0xC3) { o += (d == 0xB6 || d == 0x96) ? 'O' : (d == 0xBC || d == 0x9C) ? 'U' : (d == 0xA7 || d == 0x87) ? 'C' : '?'; }
    else if (c == 0xC4) { o += (d == 0x9F || d == 0x9E) ? 'G' : (d == 0xB1) ? 'I' : (d == 0xB0) ? 'I' : '?'; }
    else if (c == 0xC5) { o += (d == 0x9F || d == 0x9E) ? 'S' : '?'; }
    else o += '?';
  }
  return o;
}

static void mesaj(const char* a, const char* b, uint16_t renk) {
  tft.fillScreen(ILI9341_BLACK);
  tft.setTextColor(renk);
  tft.setTextSize(2);
  tft.setCursor(12, 140);
  tft.println(a);
  if (b) { tft.setTextColor(ILI9341_WHITE); tft.setTextSize(1); tft.setCursor(12, 170); tft.println(b); }
}

static void qrCiz(const char* metin) {
  QRCode qr;
  uint8_t veri[qrcode_getBufferSize(3)];
  qrcode_initText(&qr, veri, 3, ECC_MEDIUM, metin);
  const int modul = 240 / (qr.size + 8);
  const int kenar = (240 - qr.size * modul) / 2;
  const int ust = 30;
  tft.fillScreen(ILI9341_WHITE);
  for (uint8_t y = 0; y < qr.size; y++)
    for (uint8_t x = 0; x < qr.size; x++)
      if (qrcode_getModule(&qr, x, y)) tft.fillRect(kenar + x * modul, ust + y * modul, modul, modul, ILI9341_BLACK);
  tft.setTextColor(ILI9341_BLACK);
  tft.setTextSize(2);
  tft.setCursor(45, ust + qr.size * modul + 18);
  tft.println("Uygulamadan");
  tft.setCursor(75, ust + qr.size * modul + 42);
  tft.println("okutun");
}

static void darbe(int pin) {
  Serial.printf("[turnike] role darbesi: pin %d\n", pin);
  pinMode(pin, OUTPUT);
  digitalWrite(pin, LOW);   // aktif-low: tetik
  delay(DARBE_MS);
  pinMode(pin, INPUT);      // bırak — yüksek empedans, 3.3V/5V uyumsuzluğu hiç doğmuyor
}

static String istek(const char* yol, const String& govde) {
  if (WiFi.status() != WL_CONNECTED) return "";
  HTTPClient http;
  http.begin(String(API_BASE) + yol);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-studio-id", STUDIO_ID);
  http.addHeader("Authorization", String("Bearer ") + DEVICE_AUTH);
  http.setTimeout(6000);
  const int kod = http.POST(govde);
  const String cevap = http.getString();
  http.end();
  return kod == 200 ? cevap : "";
}

static String alanOku(const String& json, const char* alan) {
  const int i = json.indexOf(String("\"") + alan + "\"");
  if (i < 0) return "";
  const int b = json.indexOf('"', json.indexOf(':', i)) + 1;
  const int s = json.indexOf('"', b);
  return (b > 0 && s > b) ? json.substring(b, s) : "";
}

/** Yeni kod al, ekrana bas. Alınamazsa ekranda ESKİ KOD BIRAKILMAZ. */
static void kodYenile() {
  const String c = istek("/api/turnstile", "{}");
  const String kod = alanOku(c, "code");
  if (kod.length() == 6) {
    aktifKod = kod;
    const int i = c.indexOf("\"expiresAt\"");
    kodBitis = millis() + 25000;
    if (i > 0) { (void)i; }
    Serial.printf("[turnike] kod: %s\n", kod.c_str());
    qrCiz(kod.c_str());
  } else {
    // Süresi geçmiş bir QR, üyeyi çalışmayan bir şeye okutur ve hatanın kendisinde olduğunu
    // düşündürür. Susmak yanıltmaktan iyidir.
    aktifKod = "";
    mesaj("Baglanti yok", "birazdan tekrar denenecek", ILI9341_RED);
    kodBitis = millis() + 5000;
  }
}

void setup() {
  Serial.begin(115200);
  delay(300);
  Serial.println("\n[turnike] aciliyor");

  // Röleler ÖNCE serbest bırakılıyor: açılışta bir anlık tetik, kapıyı kimse okutmadan açardı.
  pinMode(PIN_ROLE_GIRIS, INPUT);
  pinMode(PIN_ROLE_CIKIS, INPUT);

  pinMode(PIN_LED, OUTPUT);
  digitalWrite(PIN_LED, HIGH);
  SPI.begin(PIN_SCK, -1, PIN_MOSI, PIN_CS);
  tft.begin(2000000);
  tft.setRotation(0);

  mesaj("WiFi...", WIFI_SSID, ILI9341_YELLOW);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  for (int i = 0; i < 40 && WiFi.status() != WL_CONNECTED; i++) { delay(500); Serial.print('.'); }
  Serial.println();
  Serial.printf("[turnike] %s\n", WiFi.status() == WL_CONNECTED ? WiFi.localIP().toString().c_str() : "WiFi YOK");

  kodYenile();
}

void loop() {
  if (aktifKod.length() == 6) {
    const String c = istek("/api/turnstile/status", String("{\"code\":\"") + aktifKod + "\"}");
    if (c.indexOf("\"crossed\":{") >= 0) {
      const String ad = asciile(alanOku(c, "firstName"));
      Serial.printf("[turnike] GECIS: %s\n", ad.c_str());

      // Önce kol, sonra ekran: üye kolun döndüğünü görmeden yazıyı okumaz.
      darbe(PIN_ROLE_GIRIS);

      tft.fillScreen(ILI9341_BLACK);
      tft.setTextColor(ILI9341_GREEN);
      tft.setTextSize(3);
      tft.setCursor(20, 120);
      tft.println("Hos geldin");
      tft.setTextColor(ILI9341_WHITE);
      tft.setCursor(20, 165);
      tft.println(ad.length() ? ad.c_str() : "");
      delay(KARSILAMA_MS);

      kodYenile();  // kullanılan kod ölüdür, hemen yenisi
      return;
    }
  }

  if (millis() > kodBitis) kodYenile();
  delay(SORGU_MS);
}
