// TURNİKE — İKİ EKRAN, TEK KART
//
// Turnikenin iki tarafında birer ekran var ve her biri AYRI bir cihaz: kendi kimliği, kendi sırrı,
// kendi QR'ı. Yön, okutulan EKRANDAN kesin geliyor — sunucunun "içeride mi?" diye tahmin etmesine
// gerek kalmıyor. Ama ikisi tek bir ESP32'de yaşıyor: ekranlar turnike gövdesinde 50 cm'den yakın,
// o mesafede SPI sorun çıkarmıyor ve ikinci bir kart iki kez WiFi, iki kez besleme, iki kez arıza
// demek. Ekranlar SCK/MOSI/DC/RST/LED'i PAYLAŞIR; ayrı olan tek şey CS.
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

// HANGİ KUTUYU DERLİYORUZ (2026-08-28). İki fiziksel cihaz var — giriş ve çıkış — ve her birinin
// kendi kimliği, anahtarı ve röle kanalı var. Dosya adı derleme bayrağından geliyor; `platformio.ini`
// içindeki ortam seçimi (`-e giris` / `-e cikis`) hangi kutuya yazdığını tek yerde belirliyor.
#include "secrets.h"

static const int PIN_SCK = 12;
static const int PIN_MOSI = 11;
static const int PIN_DC = 13;
static const int PIN_RST = 8;
static const int PIN_CS_GIRIS = 10;  // giriş ekranının CS'i
static const int PIN_CS_CIKIS = 9;   // çıkış ekranının CS'i — TEK farklı pin
static const int PIN_LED = 18;
// Her ekran KENDİ röle kanalını sürer: giriş ekranından okutan biri çıkış kolunu döndüremesin.
static const int PIN_ROLE_GIRIS = 5;   // In1
static const int PIN_ROLE_CIKIS = 4;   // In2

// BUZZER — üye ekrana değil, kola bakar (2026-08-28).
//
// Okuttuktan sonra kimse ekranı okumuyor; kolun dönmesini bekliyor. Ses, ekranın yapamadığı işi
// yapıyor — özellikle "okundu ama geçemedi" hâlinde, ki orada üye ne olduğunu hiç anlamıyor.
//
// AKTİF buzzer, doğrudan GPIO'dan sürülüyor: 5V'luk bir buzzer 3.3V'ta daha kısık öter ama öter, ve
// araya transistör koymak parça beklemek demekti. Bu yüzden bipler KISA — sürekli sürüş pinin rahat
// akım sınırını zorlar, 120 ms zorlamaz. Ses yetersiz kalırsa çözüm NPN + 5V, kod değişmez.
static const int PIN_BUZZER = 14;
static const uint32_t BIP_MS = 120;

// Turnike kendi süresini sayıyor (F01), bize sadece tetiklemek düşüyor.
static const uint32_t DARBE_MS = 300;
static const uint32_t SORGU_MS = 600;      // "kodum kullanıldı mı"
static const uint32_t KARSILAMA_MS = 3000; // ekranda ismin kaldığı süre

static Adafruit_ILI9341 tftGiris(PIN_CS_GIRIS, PIN_DC, PIN_RST);
static Adafruit_ILI9341 tftCikis(PIN_CS_CIKIS, PIN_DC, PIN_RST);

/** Bir kapı = bir ekran + bir kimlik + bir röle kanalı. İkisi de aynı döngüde yürüyor. */
struct Kapi {
  const char* ad;              // yalnızca log için
  const char* auth;            // cihazın Bearer kimliği
  Adafruit_ILI9341* tft;
  int rolePin;
  String kod;
  uint32_t kodBitis;
};

static Kapi kapilar[] = {
  { "giris", DEVICE_AUTH_GIRIS, &tftGiris, PIN_ROLE_GIRIS, "", 0 },
  { "cikis", DEVICE_AUTH_CIKIS, &tftCikis, PIN_ROLE_CIKIS, "", 0 },
};
static const size_t KAPI_SAYISI = sizeof(kapilar) / sizeof(kapilar[0]);

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

static void mesaj(Kapi& k, const char* a, const char* b, uint16_t renk) {
  Adafruit_ILI9341& tft = *k.tft;
  tft.fillScreen(ILI9341_BLACK);
  tft.setTextColor(renk);
  tft.setTextSize(2);
  tft.setCursor(12, 140);
  tft.println(a);
  if (b) { tft.setTextColor(ILI9341_WHITE); tft.setTextSize(1); tft.setCursor(12, 170); tft.println(b); }
}

static void qrCiz(Kapi& k, const char* metin) {
  Adafruit_ILI9341& tft = *k.tft;
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

/** `adet` kısa bip. Sesin ANLAMI var: 1 = geçtin, 2 = olmadı, 3 = bağlantı yok. */
static void bip(int adet) {
  for (int i = 0; i < adet; i++) {
    digitalWrite(PIN_BUZZER, HIGH);
    delay(BIP_MS);
    digitalWrite(PIN_BUZZER, LOW);
    if (i + 1 < adet) delay(90);
  }
}

static void darbe(int pin) {
  Serial.printf("[turnike] role darbesi: pin %d\n", pin);
  pinMode(pin, OUTPUT);
  digitalWrite(pin, LOW);   // aktif-low: tetik
  delay(DARBE_MS);
  pinMode(pin, INPUT);      // bırak — yüksek empedans, 3.3V/5V uyumsuzluğu hiç doğmuyor
}

static String istek(Kapi& k, const char* yol, const String& govde) {
  if (WiFi.status() != WL_CONNECTED) return "";
  HTTPClient http;
  http.begin(String(API_BASE) + yol);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-studio-id", STUDIO_ID);
  http.addHeader("Authorization", String("Bearer ") + k.auth);
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
static void kodYenile(Kapi& k) {
  const String c = istek(k, "/api/turnstile", "{}");
  const String kod = alanOku(c, "code");
  if (kod.length() == 6) {
    k.kod = kod;
    k.kodBitis = millis() + 25000;
    Serial.printf("[turnike:%s] kod: %s\n", k.ad, kod.c_str());
    qrCiz(k, kod.c_str());
  } else {
    // Süresi geçmiş bir QR, üyeyi çalışmayan bir şeye okutur ve hatanın kendisinde olduğunu
    // düşündürür. Susmak yanıltmaktan iyidir.
    k.kod = "";
    mesaj(k, "Baglanti yok", "birazdan tekrar denenecek", ILI9341_RED);
    bip(3);
    k.kodBitis = millis() + 5000;
  }
}

void setup() {
  Serial.begin(115200);
  delay(300);
  Serial.println("\n[turnike] aciliyor");

  // Röleler ÖNCE serbest bırakılıyor: açılışta bir anlık tetik, kapıyı kimse okutmadan açardı.
  for (size_t i = 0; i < KAPI_SAYISI; i++) pinMode(kapilar[i].rolePin, INPUT);

  // Tek arka ışık pini iki ekranı da yakıyor: o bacak modüldeki transistörün bazını sürüyor, akımı
  // ekranın kendi VCC'sinden çekiyor. İki modül için bir GPIO fazlasıyla yeter.
  // Buzzer önce SUSTURULUYOR: açılışta bir anlık yüksek, boş bir stüdyoda öten bir kutu demek.
  pinMode(PIN_BUZZER, OUTPUT);
  digitalWrite(PIN_BUZZER, LOW);

  pinMode(PIN_LED, OUTPUT);
  digitalWrite(PIN_LED, HIGH);

  // CS'siz başlatılıyor: her ekran kendi CS'ini kendi nesnesinden sürüyor, veri yolu ortak.
  SPI.begin(PIN_SCK, -1, PIN_MOSI, -1);
  for (size_t i = 0; i < KAPI_SAYISI; i++) {
    kapilar[i].tft->begin(2000000);
    kapilar[i].tft->setRotation(0);
    mesaj(kapilar[i], "WiFi...", WIFI_SSID, ILI9341_YELLOW);
  }

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  for (int i = 0; i < 40 && WiFi.status() != WL_CONNECTED; i++) { delay(500); Serial.print('.'); }
  Serial.println();
  Serial.printf("[turnike] %s\n", WiFi.status() == WL_CONNECTED ? WiFi.localIP().toString().c_str() : "WiFi YOK");

  for (size_t i = 0; i < KAPI_SAYISI; i++) kodYenile(kapilar[i]);
}

/** Bir kapının bir turu: kodu kullanıldı mı, kullanıldıysa kolu çevir ve karşıla. */
static void kapiTuru(Kapi& k) {
  if (k.kod.length() == 6) {
    const String c = istek(k, "/api/turnstile/status", String("{\"code\":\"") + k.kod + "\"}");
    if (c.indexOf("\"crossed\":{") >= 0) {
      const String ad = asciile(alanOku(c, "firstName"));
      Serial.printf("[turnike:%s] GECIS: %s\n", k.ad, ad.c_str());

      // Önce kol, sonra ses, sonra ekran: üye önce kolun döndüğünü hisseder, sesi duyar, en son
      // yazıya bakar — bakarsa.
      darbe(k.rolePin);
      bip(1);

      Adafruit_ILI9341& tft = *k.tft;
      tft.fillScreen(ILI9341_BLACK);
      tft.setTextColor(ILI9341_GREEN);
      tft.setTextSize(3);
      tft.setCursor(20, 120);
      tft.println("Hos geldin");
      tft.setTextColor(ILI9341_WHITE);
      tft.setCursor(20, 165);
      tft.println(ad.length() ? ad.c_str() : "");
      // Karşılama süresi boyunca ÖBÜR kapı beklemede. İki kişinin aynı saniyede iki taraftan
      // geçmesi nadir; buna karşılık kodu basit tutmak, turnikede debug etmeyeceğimiz anlamına
      // geliyor. Sorun olursa burası bloklamayan bir zamanlayıcıya döner.
      delay(KARSILAMA_MS);

      kodYenile(k);  // kullanılan kod ölüdür, hemen yenisi
      return;
    }
  }
  if (millis() > k.kodBitis) kodYenile(k);
}

void loop() {
  for (size_t i = 0; i < KAPI_SAYISI; i++) kapiTuru(kapilar[i]);
  delay(SORGU_MS);
}
