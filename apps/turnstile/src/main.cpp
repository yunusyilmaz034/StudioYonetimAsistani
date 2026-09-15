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
#include <WiFiClientSecure.h>
#include <esp_system.h>
#include <qrcode.h>
#include <time.h>

// İKİ KİMLİK, TEK KUTU (2026-08-28; yorum 2026-09-01'de düzeltildi).
//
// İki cihaz var — giriş ve çıkış — ve her birinin kendi kimliği, anahtarı ve röle kanalı var. Ama
// ikisi de AYNI ESP32'de çalışıyor, iki ayrı kart yok: `secrets.h` iki `DEVICE_AUTH_*` taşıyor ve
// `kapilar[]` ikisini birden yürütüyor.
//
// Bu yüzden **tek ortam, tek yükleme**: `pio run -t upload`. Bir zamanlar buraya `-e giris` /
// `-e cikis` yazılmıştı; öyle ortamlar hiç var olmadı ve o komut hata verir.
#include "secrets.h"
#include "provision.h"
#include "ui.h"

static const int PIN_SCK = 12;
static const int PIN_MOSI = 11;
static const int PIN_DC = 13;
static const int PIN_RST = 8;
static const int PIN_CS_GIRIS = 10;  // giriş ekranının CS'i
static const int PIN_CS_CIKIS = 9;   // çıkış ekranının CS'i — TEK farklı pin.
                                     // 6 DEĞİL: iki kez denendi, 6'da yalnızca bir ekran açılıyor.
                                     // 9'da ikisi birden çalıştı ve fotoğrafla kayıtlı. Sebebini
                                     // bilmiyoruz; bildiğimiz şey hangisinin çalıştığı.
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
// 16, ve pin ASLA BOŞTA BIRAKILMAZ (owner, 2026-09-01 — gizli hata buydu).
//
// Aktif-LOW modülde buzzer'ın bir ucu 3.3 V'ta, öbür ucu bu pinde. Pini INPUT yapmak onu boşta
// bırakmak demek, ve boşta bırakmak açılıştaki iç pull-up'ı da kapatıyor. O anda buzzer kendi
// üzerinden pine akım akıtıyor: 3.3 V rayı yükleniyor ve pinin koruma diyotlarına akım basıyor.
// Ekranlar o raydaki en ağır yük — başlatma dizisi bu yüzden tutmuyordu.
//
// Belirti "imkânsız" görünüyordu: `pinMode(16, INPUT)` hiçbir şey yapmaz. **Takılı bir buzzer
// varken yapar.** Pin 6'da olmamasının sebebi de buydu: oraya bağlı bir şey yoktu.
//
// Doğru boşta hâli HIGH: buzzer'ın iki ucu da 3.3 V'ta, akım sıfır, yük sıfır.
static const int PIN_BUZZER = 16;
static const uint32_t BIP_MS = 250;

// ── BUZZER SÜRÜCÜSÜ — TEK ANAHTAR (2026-09-03) ────────────────────────────────────────────────
//
// NPN transistör takıldığı gün DEĞİŞECEK TEK ŞEY bu satırdır: `false` → `true`, sonra karta at.
// Başka hiçbir yere dokunulmaz — sessizlik ve ötme seviyeleri buradan türüyor, ve `setup()` ile
// `bip()` ikisi de aynı yerden okuyor. Sebebi acı: polarite iki yere elle yazılırsa biri unutulur,
// ve kutu ya hiç ötmez ya hiç susmaz — bu kart bir akşamını tam olarak buna yedirmişti.
//
// NEDEN TERS DÖNÜYOR: bugün buzzer 5 V'luk modülün içinde `VCC` ile `S` arasında duruyor ve akımı
// pinin İÇİNDEN geçiyor — pin LOW olunca ötüyor (aktif-LOW), ve ses bu yüzden kısık (DEBT-038).
// Transistör girince pin artık buzzer'ı değil transistörün BAZINI sürüyor: HIGH olunca iletime
// geçiyor, buzzer 5 V'unu 3.3 V yerine besleme hattından çekiyor. Yani anahtar HIGH'a dönüyor.
//
// Transistör takılıp bu satır `false` bırakılırsa kutu SÜREKLİ öter ve bip attığında SUSAR — ve bu,
// ters polarite gibi değil BOZUK PARÇA gibi görünür. O yüzden burada duruyor, bir yorumda değil.
//
// Bağlantı (DEBT-038): modül `VCC` → 5 V · modül `S` → kollektör · `GPIO 16` →[1 kΩ]→ baz ·
// baz–GND arası 10 kΩ (açılışta boşta kalan pin buzzer'ı öttürmesin) · emiter → GND.
static const bool BUZZER_NPN = false;

// Seviyeler sürücüden ÇIKAR, elle yazılmaz.
static const int BUZZER_SUS = BUZZER_NPN ? LOW : HIGH;
static const int BUZZER_OT = BUZZER_NPN ? HIGH : LOW;

// BUZZER: SÜRÜLMEZ, YALNIZCA ÖTERKEN ÇEKİLİR (owner, 2026-09-01, montajda).
//
// Takılan KY-012 modülü AKTİF-LOW: buzzer `VCC` ile `S` arasında duruyor, yani `S` düşükken ötüyor.
// İlk çözüm bariz görünüyordu — sussun diye pini HIGH tut. **İki ekran birden beyaz kaldı.**
//
// Sebebini BİLMİYORUZ. Bildiğimiz şey, `GPIO 6`nın bu kartta ikinci kez ekranları bozduğu: bir kez
// çıkış ekranının `CS`'i olarak denenip elenmişti ("6'da yalnızca bir ekran açılıyor"), şimdi de
// HIGH sürülünce paneller hiç başlamadı. Teşhis modu ayırdı: `-D BUZZERSIZ` ile pine hiç
// dokunulmayınca yazılar geldi.
//
// Çözüm kabloyu taşımak değil — pini hiç sürmemek. Boşta (INPUT) bırakıldığında buzzer SESSİZ, bu
// da aynı akşam ölçüldü. Yani `darbe()`nin röle için yaptığının aynısı: normalde yüksek empedans,
// yalnızca iş görürken sür. HIGH hiç yazılmıyor, ve o satırın yokluğu kuralın kendisidir.

// ── SÜRÜM (v1.4, 2026-09-14) ──────────────────────────────────────────────────────────────────
//
// Her kod isteğinde sunucuya gidiyor ve Ayarlar → Turnike cihazları'nda görünüyor. "Hangi firmware
// yüklüydü?" sorusu bir daha tahminle cevaplanmasın diye. Yüklemeden sonra etiket: `turnike-v1.4`.
static const char* FW_SURUM = "turnike-v1.5";

// Turnike kendi süresini sayıyor (F01), bize sadece tetiklemek düşüyor.
//
// SAHADA DENENEBİLİR (v1.4): "hoş geldin dedi, kol dönmedi" günü 300 ms'nin turnike kartına yetip
// yetmediğini ÖLÇMEDİK (DEBT-046). Kodu değiştirmeden başka bir değer denemek için `platformio.ini`ye
// `-D DARBE_MS_AYAR=500` yazılır ve yeniden yüklenir.
#ifdef DARBE_MS_AYAR
static const uint32_t DARBE_MS = DARBE_MS_AYAR;
#else
static const uint32_t DARBE_MS = 300;
#endif
static const uint32_t SORGU_MS = 600;      // "kodum kullanıldı mı"
static const uint32_t KARSILAMA_MS = 3000; // ekranda ismin kaldığı süre

static Adafruit_ILI9341 tftGiris(PIN_CS_GIRIS, PIN_DC, PIN_RST);
// İKİNCİ EKRAN RST'YE DOKUNMAZ (2026-08-28).
//
// `RESET` hattı iki panelde ORTAK. Kütüphanenin `begin()`'i o hattı darbeliyor, yani ikinci ekranın
// başlatılması BİRİNCİ paneli sıfırlıyor — ve birinci bir daha ayarlanmadığı için ayarsız kalıyor.
// Ayarsız bir ILI9341 beyaz görünür; biz onu günlerce "çizim yarıda kalıyor" diye okuduk, halbuki
// panel hiç başlamamıştı.
//
// `-1` vererek ikinci nesneye "reset pini yok" diyoruz. Donanımsal sıfırlamayı birinci nesnenin
// `begin()`'i zaten yapıyor ve o tek darbe iki paneli birden sıfırlıyor — hat ortak olduğu için.
static Adafruit_ILI9341 tftCikis(PIN_CS_CIKIS, PIN_DC, -1);

/** Bir kapı = bir ekran + bir kimlik + bir röle kanalı. İkisi de aynı döngüde yürüyor. */
struct Kapi {
  const char* ad;              // yalnızca log için
  const char* baslik;          // ekranda QR'ın üstünde duran yön yazısı
  String auth;                 // cihazın Bearer kimliği — NVS'ten ya da secrets.h'ten
  Adafruit_ILI9341* tft;
  int rolePin;
  // EKRANIN FİZİKSEL DURUŞU (owner, 2026-09-09): çıkış ekranı gövdeye ters monte edildi, tutacağı
  // öbür tarafa geliyor. Kodun döndürmesi, panelin sökülüp çevrilmesinden ucuz — ve montaj bir kez
  // yapılıyor. 0 = düz, 2 = 180°. Yerleşim dikey kaldığı için bütün koordinatlar aynen geçerli.
  uint8_t rotasyon;
  String kod;
  uint32_t kodBitis;
  Yuz yuz;   // ekranın çizim durumu — UI katmanının tek hafızası
};

// İKİ KAPI AÇIK (`-D IKI_KAPI`, `platformio.ini`).
//
// 2026-08-28 gecesi ikinci kapı geçici olarak kapatılmıştı: çizim iki ekranda `fillScreen` sonrası
// kalıyordu ve seri log bu kartta akmadığı için sebebi körlemesine arıyorduk. Sebep sonradan
// bulundu ve yukarıda yazılı — ortak `RESET` hattı ve tek SPI işlemi. İkisi de düzeldiğinden beri
// iki ekran birlikte çalışıyor.
//
// Bayrak yerinde duruyor: bir sorun çıkarsa `platformio.ini`den o satırı silmek, kurulumu tek
// kapıyla ayakta tutar.
static Kapi kapilar[] = {
  { "giris", "GIRIS", DEVICE_AUTH_GIRIS, &tftGiris, PIN_ROLE_GIRIS, 0, "", 0, { &tftGiris, Mod::Giris, Ekran::Yok, "" } },
#ifdef IKI_KAPI
  { "cikis", "CIKIS", DEVICE_AUTH_CIKIS, &tftCikis, PIN_ROLE_CIKIS, 2, "", 0, { &tftCikis, Mod::Cikis, Ekran::Yok, "" } },
#endif
};
static const size_t KAPI_SAYISI = sizeof(kapilar) / sizeof(kapilar[0]);

#ifdef TESHIS
/**
 * EKRAN, LOGUN KENDİSİ (2026-08-28).
 *
 * Bu kart seri çıktı vermiyor — CDC_ON_BOOT, USB_MODE, DTR, hepsi denendi, 0 bayt. Logsuz arama
 * bir gün yedi ve ikinci ekranda tekrar aynı yere geldik. Elimizde ekran varken körlemesine
 * aramanın anlamı yok: QR yerine DURUMU basıyoruz.
 *
 * Sadece metin çiziyor — QR döngüsü hiç çalışmıyor. Metin görünürse çizim sağlam demektir ve suçlu
 * QR yolu; metin de görünmezse çizimin kendisi iki kapıyla bozuluyor demektir. İki cevaptan biri.
 */
static void teshisCiz(Kapi& k, const char* kod) {
  Adafruit_ILI9341& tft = *k.tft;
  tft.setFont();  // teşhis ekranı yerleşik fontla çizer
  tft.fillScreen(ILI9341_BLACK);
  tft.setTextColor(ILI9341_WHITE);
  tft.setTextSize(2);
  tft.setCursor(6, 20);   tft.println(k.ad);
  tft.setCursor(6, 60);   tft.print("kod:"); tft.println(kod);
  tft.setCursor(6, 100);  tft.print("wifi:"); tft.println(WiFi.status() == WL_CONNECTED ? "ok" : "yok");
  tft.setCursor(6, 140);  tft.print("heap:"); tft.println((int)ESP.getFreeHeap());
  tft.setCursor(6, 180);  tft.print("up:"); tft.println((int)(millis() / 1000));
}
#endif

/** `adet` kısa bip. Sesin ANLAMI var: 1 = geçtin, 2 = olmadı, 3 = bağlantı yok. */
static void bip(int adet) {
  for (int i = 0; i < adet; i++) {
    digitalWrite(PIN_BUZZER, BUZZER_OT);
    delay(BIP_MS);
    digitalWrite(PIN_BUZZER, BUZZER_SUS); // sus — INPUT DEĞİL: boşta bırakmak buzzer'a akım yolu açıyor
    if (i + 1 < adet) delay(90);
  }
}

// Açılıştan beri verilen darbe sayısı — sunucuya gider. "Sunucu geçti dedi" sayısıyla yan yana
// konunca, kutunun darbeyi GERÇEKTEN verip vermediği ayrılır: sayı artıyor ve kol dönmüyorsa suç
// rölenin ötesinde (turnike kartı, besleme), artmıyorsa kutunun içinde.
static uint32_t darbeSayisi = 0;
// Son kez bir kapıdan geçildiği an (millis) — gece yeniden başlatması boş bir kapıyı bekler.
static uint32_t sonHareket = 0;
// Son başarılı sunucu cevabı (millis) — takılmış bir ağ yığınını tanımak için.
static uint32_t sonBasari = 0;

static void darbe(int pin) {
  darbeSayisi++;
  sonHareket = millis();
  Serial.printf("[turnike] role darbesi #%u: pin %d, %u ms\n", (unsigned)darbeSayisi, pin, (unsigned)DARBE_MS);
  pinMode(pin, OUTPUT);
  digitalWrite(pin, LOW);   // aktif-low: tetik
  delay(DARBE_MS);
  pinMode(pin, INPUT);      // bırak — yüksek empedans, 3.3V/5V uyumsuzluğu hiç doğmuyor
}

/** Açılış sebebi — `BROWNOUT` beslemenin düştüğü, `PANIC`/`*_WDT` yazılımın çöktüğü anlamına gelir. */
static const char* acilisSebebi() {
  switch (esp_reset_reason()) {
    case ESP_RST_POWERON: return "POWERON";
    case ESP_RST_EXT: return "EXT";
    case ESP_RST_SW: return "SW";
    case ESP_RST_PANIC: return "PANIC";
    case ESP_RST_INT_WDT: return "INT_WDT";
    case ESP_RST_TASK_WDT: return "TASK_WDT";
    case ESP_RST_WDT: return "WDT";
    case ESP_RST_DEEPSLEEP: return "DEEPSLEEP";
    case ESP_RST_BROWNOUT: return "BROWNOUT";
    case ESP_RST_SDIO: return "SDIO";
    default: return "UNKNOWN";
  }
}

// ── BAĞLANTI AÇIK KALIR (v1.4, 2026-09-14) ─────────────────────────────────────────────────────
//
// v1.3 her istekte YENİ bir TLS bağlantısı kuruyordu: saniyede ~1,5 istek × iki kapı, her birinde
// tam el sıkışma. ESP32'de bir el sıkışma yüzlerce ms ve ciddi bellek; stüdyonun interneti
// yavaşladığı gün (14.09) cihazın geçişi görmesi 5,7 saniyeye çıktı. Artık tek bağlantı açık kalıyor
// ve iki kapı onu sırayla kullanıyor (döngü tek görev, aynı anda iki istek hiç olmuyor).
//
// Sertifika DOĞRULANMIYOR — v1.3'te de doğrulanmıyordu: CA verilmeyen `HTTPClient` içeride
// `setInsecure()` çağırıyor. Davranış değişmedi, yalnızca görünür oldu. Kutunun yetkisi zaten
// sınırlı: kod ister, kod sorar; kapıyı açma kararı sunucuda (DEBT-046'da not).
static WiFiClientSecure tls;
static HTTPClient http;

static String istek(Kapi& k, const char* yol, const String& govde) {
  if (WiFi.status() != WL_CONNECTED) return "";
  // İki deneme: açık tutulan bağlantıyı sunucu ya da modem sessizce kapatmış olabilir. O zaman ilk
  // deneme negatif kodla döner (bağlantı hatası, HTTP cevabı değil); bağlantıyı atıp bir kez temiz kurarız.
  for (int deneme = 0; deneme < 2; deneme++) {
    http.begin(tls, String(API_BASE) + yol);
    http.setReuse(true);
    http.setTimeout(6000);
    http.setConnectTimeout(6000);
    http.addHeader("Content-Type", "application/json");
    http.addHeader("x-studio-id", STUDIO_ID);
    http.addHeader("Authorization", String("Bearer ") + k.auth);
    // Ölçüm başlıkları — sunucu yalnızca kod isteğinde kaydediyor; ötekilerde yok sayıyor.
    http.addHeader("x-fw", FW_SURUM);
    http.addHeader("x-rssi", String(WiFi.RSSI()));
    http.addHeader("x-heap", String(ESP.getFreeHeap()));
    http.addHeader("x-uptime", String(millis() / 1000));
    http.addHeader("x-pulses", String(darbeSayisi));
    http.addHeader("x-reset", acilisSebebi());
    const int kod = http.POST(govde);
    if (kod < 0) {
      Serial.printf("[turnike:%s] baglanti hatasi %d (deneme %d)\n", k.ad, kod, deneme + 1);
      http.end();
      tls.stop();
      continue;
    }
    const String cevap = http.getString();
    http.end();
    if (kod == 200) sonBasari = millis();
    return kod == 200 ? cevap : "";
  }
  return "";
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
#ifdef TESHIS
    teshisCiz(k, kod.c_str());
    k.yuz.ekran = Ekran::Yok;  // teşhis ekranı UI'ın dışında çizdi; hafızası geçersiz
#else
    uiHazir(k.yuz, kod);
#endif
  } else {
    // Süresi geçmiş bir QR, üyeyi çalışmayan bir şeye okutur ve hatanın kendisinde olduğunu
    // düşündürür. Susmak yanıltmaktan iyidir.
    k.kod = "";
    uiBaglaniyor(k.yuz);
    bip(3);
    k.kodBitis = millis() + 5000;
  }
}

/**
 * Kurulum modunun ekranı. Normal çalışmada IP/SSID göstermek YASAK — orada duran kişi üyedir.
 * Burada duran kişi montajcıdır ve tam olarak bu bilgilere ihtiyacı var. İki ekran, iki izleyici,
 * iki kural.
 */
static void kurulumEkrani(const char* baslik, const char* alt1, const char* alt2) {
  for (size_t i = 0; i < KAPI_SAYISI; i++) uiKurulum(kapilar[i].yuz, baslik, alt1, alt2);
}

void setup() {
  // Buzzer BAŞTAN ve HER ZAMAN sürülü. Boşta bırakılırsa buzzer kendi üzerinden pine akım akıtıyor
  // ve o akım ekranların başlamasını engelliyor. Bu satırın YERİ de önemli — her şeyden önce, çünkü
  // ondan önceki her satır o akımın aktığı süredir. Seviye `BUZZER_SUS`tan geliyor: bugün HIGH,
  // transistör takılınca LOW. Burada sabit bir HIGH yazsaydı, NPN'den sonra kutu açılıştan itibaren
  // öterdi ve tek anahtarın anlamı kalmazdı.
  pinMode(PIN_BUZZER, OUTPUT);
  digitalWrite(PIN_BUZZER, BUZZER_SUS);

  Serial.begin(115200);
  delay(300);
  Serial.println("\n[turnike] aciliyor");

  // Röleler ÖNCE serbest bırakılıyor: açılışta bir anlık tetik, kapıyı kimse okutmadan açardı.
  for (size_t i = 0; i < KAPI_SAYISI; i++) pinMode(kapilar[i].rolePin, INPUT);

  // ── ARKA IŞIK, BAŞLATMADAN SONRA (owner, 2026-09-08 gecesi — montajdan sonra beyaz ekran) ──
  //
  // Tek arka ışık pini iki ekranı da yakıyor: o bacak modüldeki transistörün bazını sürüyor, akımı
  // ekranın kendi VCC'sinden çekiyor. İki modül için bir GPIO fazlasıyla yeter.
  //
  // ÖNCEDEN BURADA `HIGH` YAZIYORDU ve iki arka ışık, paneller yapılandırılırken zaten yanıyordu.
  // Montajdan sonra kutuya yeni yükler girdi (röle kartının 5 V'u gerçekten bağlandı, buzzer
  // takılı) ve besleme USB'den geliyor. Ray sıkışınca panel HİÇ başlamıyor — ve yapılandırılmamış
  // bir ILI9341, arka ışığı yanan BEYAZ bir dikdörtgendir. "Bazen beyaz geliyor, takıp çıkarınca
  // düzeliyor" tarifi tam olarak budur: her açılışta yarışı bazen kazanıyor, bazen kaybediyor.
  //
  // Arka ışık artık en son yanıyor: başlatma anındaki tepe akımdan iki modülü birden çıkarıyoruz.
  // Bu bir ÇÖZÜM DEĞİL, PAYDIR — beslemesi yetersiz bir kutuyu yazılım kurtaramaz (DEBT-044).
  pinMode(PIN_LED, OUTPUT);
  digitalWrite(PIN_LED, LOW);

  // CS'siz başlatılıyor: her ekran kendi CS'ini kendi nesnesinden sürüyor, veri yolu ortak.
  SPI.begin(PIN_SCK, -1, PIN_MOSI, -1);
  delay(120);

  // ── RESET'İ KENDİMİZ DARBELEYELİM (13.09.2026) ────────────────────────────────────────────
  //
  // `RST` (GPIO 8) İKİ PANELDE ORTAK ve en güçlü şüpheli: tek bir gevşek uç, iki ekranı birden
  // öldürür ve takıp çıkarınca düzelir — tarif birebir bu. Kütüphanenin kendi darbesi kısa;
  // burada uzun ve temiz bir darbe atıyoruz, sonra panelin toparlanması için bekliyoruz.
  // Marjinal bir hatta bu bazen yeter; yetmiyorsa da suçu daralt: yazılım elinden geleni yaptı.
  pinMode(PIN_RST, OUTPUT);
  digitalWrite(PIN_RST, HIGH); delay(20);
  digitalWrite(PIN_RST, LOW);  delay(50);   // veri sayfası 10 µs ister; 50 ms cömert ve zararsız
  digitalWrite(PIN_RST, HIGH); delay(150);  // ray otursun: açılışta USB regülatörü henüz toparlanıyor

  // ÖNCE İKİSİNİ DE BAŞLAT, SONRA ÇİZ. `RESET` hattı ortak: ikinci ekranın `begin()`'i o hattı
  // darbeliyor ve BİRİNCİ ekranı siliyor. Başlatıp hemen çizersen, birinci ekran bir sonraki
  // satırda kararıyor — ve bunu "ekran bozuk" diye okursun.
  //
  // İKİ KEZ, BİLEREK. Panelde MISO bağlı değil (`SPI.begin(..., -1, ...)`), yani başladı mı diye
  // SORAMIYORUZ — okuma yolu fiziksel olarak yok. Soramadığımıza göre tekrar ediyoruz: ilk tur
  // rayın en sıkışık anına denk gelip düşerse, ikincisi 150 ms sonra sakin bir rayda tutar.
  // Tur BÜTÜN olarak tekrarlanıyor, tek tek değil: `giris`in `begin()`'i ortak `RESET`i darbeleyip
  // `cikis`i siler, dolayısıyla ikisi hep birlikte kurulmalı.
  // ── ALTI TUR, TEK TUR DEĞİL (13.09.2026, montajda ölçüldü) ────────────────────────────────
  //
  // Ölçüm şunu eledi: beyaz ekran varken arka ışık YANIYOR, yani panellerde 3.3 V var — besleme
  // değil. Kod da sonuna kadar çalışıyor (dört nabız görünüyor). Geriye tek açıklama kalıyor:
  // SPI yapılandırması panellere ULAŞMIYOR. Ortak hatlar `SCK·MOSI·DC·RST`; `CS` ayrı olduğu hâlde
  // ikisi birden ölüyor, yani suçlu o dördünden biri ve temassızlığı MARJİNAL (bazen tutuyor).
  //
  // Marjinal bir temasta tek deneme yazı tura atmaktır. Altı deneme, aralarında nefesle: %50
  // tutan bir uç %98'e çıkar. BU BİR ÇÖZÜM DEĞİL — gevşek bir kabloyu yazılım tamir edemez
  // ([[DEBT-044]], ve `TURNSTILE-HARDWARE.md` §5/3 zaten bu hatlarda dupont yasaklıyor). Ama
  // montaj gecesinde kapıyı çalışır hâlde tutar.
  //
  // Tur BÜTÜN olarak tekrarlanıyor: `giris`in `begin()`'i ortak `RESET`i darbeleyip `cikis`i
  // siliyor, dolayısıyla ikisi hep birlikte kurulmalı.
  for (int tur = 0; tur < 6; tur++) {
    for (size_t i = 0; i < KAPI_SAYISI; i++) {
      kapilar[i].tft->begin(2000000);
      kapilar[i].tft->setRotation(kapilar[i].rotasyon);
    }
    if (tur < 5) delay(120);
  }
  // Ekranı KARART, sonra ışığı yak. Sırası önemli: önce ışığı yakıp sonra karartırsak, açılışta
  // bir anlık beyaz parlama olur ve o parlama tam da teşhis etmeye çalıştığımız belirtiye benzer.
  for (size_t i = 0; i < KAPI_SAYISI; i++) kapilar[i].tft->fillScreen(0x0863);
  digitalWrite(PIN_LED, HIGH);
  // TEŞHİS: bu satır seri portta görünüyorsa panel başlatma TAMAMLANMIŞ demektir. Beyaz ekran
  // varken bu satır YOKSA kutu buraya hiç gelmiyor — yani sorun başlatmada değil, ondan
  // öncesinde. Ekrandan bakınca ikisi aynı görünüyor; bu satır ikisini ayırıyor.
  Serial.println("[turnike] ekranlar hazir, arka isik acik");
  // İKİ AĞ, TEK KART (owner, 2026-09-01).
  //
  // Kart evde kuruldu, turnike dükkânda. Tek ağ yazılı olsaydı montaj gecesi kutu hiçbir şey
  // çizmez, "Baglanti yok" der ve 3 bip öterdi — ve düzeltmek için Mac'i, kabloyu ve yeniden
  // flash'ı oraya taşımak gerekirdi. Bir kurulum gecesinin en kötü yeri, laptop olmadan fark
  // edilen bir ayar.
  //
  // Sırayla denenir, ilk bağlanan kazanır. İkinci ağ `secrets.h`de tanımlı değilse bu blok
  // derlemeye bile girmiyor.
  // ── KİMLİK VE AĞ: ÖNCE NVS, SONRA `secrets.h` (owner onayı, 2026-09-11) ────────────────────
  //
  // `secrets.h` fallback olarak KALDI ve bu bilinçli: duvardaki çalışan ünitenin NVS'i boş, ve
  // fallback olmasaydı bu firmware onu doğrudan kurulum moduna düşürürdü — çalışan bir kapıyı
  // çalışmayan bir kapıya çevirmek. Yeni ünitelerde `secrets.h` boş bırakılır, zincir kendiliğinden
  // kurulum moduna iner.
  const Ayar kayit = ayarOku();
  kapilar[0].auth = kayit.authGiris.length() ? kayit.authGiris : String(DEVICE_AUTH_GIRIS);
#ifdef IKI_KAPI
  kapilar[1].auth = kayit.authCikis.length() ? kayit.authCikis : String(DEVICE_AUTH_CIKIS);
#endif

  WiFi.mode(WIFI_STA);
  String ssidler[] = {
      kayit.ssid,          // kurulumda telefondan girilen ağ — varsa ilk o denenir
      String(WIFI_SSID),
#ifdef WIFI_SSID2
      String(WIFI_SSID2),
#endif
  };
  String sifreler[] = {
      kayit.sifre,
      String(WIFI_PASS),
#ifdef WIFI_PASS2
      String(WIFI_PASS2),
#endif
  };
  const size_t agSayisi = sizeof(ssidler) / sizeof(ssidler[0]);

  for (size_t a = 0; a < agSayisi && WiFi.status() != WL_CONNECTED; a++) {
    if (ssidler[a].length() == 0) continue;  // yazılmamış bir ağ denenmez
    Serial.printf("[turnike] deneniyor: %s\n", ssidler[a].c_str());
    for (size_t i = 0; i < KAPI_SAYISI; i++) uiBaglaniyor(kapilar[i].yuz);
    WiFi.begin(ssidler[a].c_str(), sifreler[a].c_str());
    // Ağ başına 10 saniye: yoksa 20 saniye beklemek, VAR OLAN ağa geçmeyi o kadar geciktirir.
    for (int i = 0; i < 20 && WiFi.status() != WL_CONNECTED; i++) { delay(500); Serial.print('.'); }
    Serial.println();
  }

  // HİÇBİR AĞ TUTMADIYSA KURULUM MODU. Buradan dönüş yok: ayarlar kaydedilince kart yeniden
  // başlıyor. Yarı yapılandırılmış bir kutunun çalışmaya devam etmesi, montajcıya "oldu galiba"
  // dedirtir ve o gece orada bitmez.
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[turnike] ag yok → kurulum modu");
    // Bilinen bir ağ VARSA 5 dk'lık zaman aşımı (v1.4): elektrik gelince modem kutudan geç açılır, ve
    // artık kutu kendini de yeniden başlatabiliyor — ikisi, ağ bir anlığına yokken çakışırsa çalışan
    // kapı kurulum ekranında kalmasın. Hiç ağ yazılmamış yeni kutu eskisi gibi sonsuza dek bekler.
    bool bilinenAg = false;
    for (size_t a = 0; a < agSayisi; a++) bilinenAg = bilinenAg || ssidler[a].length() > 0;
    kurulumModu(kurulumEkrani, bilinenAg ? 5UL * 60 * 1000 : 0);
  }
  tls.setInsecure();  // v1.3 ile aynı davranış; bkz. `istek()`
  // Saat yalnızca gece yeniden başlatmasının "gece mi?" sorusu için. Alınamazsa o özellik susar; kapı etkilenmez.
  configTzTime("<+03>-3", "pool.ntp.org", "time.google.com");
  sonBasari = millis();
  Serial.printf("[turnike] %s (%s)\n",
                WiFi.status() == WL_CONNECTED ? WiFi.localIP().toString().c_str() : "WiFi YOK",
                WiFi.status() == WL_CONNECTED ? WiFi.SSID().c_str() : "-");

  for (size_t i = 0; i < KAPI_SAYISI; i++) kodYenile(kapilar[i]);
}

/**
 * Karşılama/ret ekranından sonra hâlâ geçerli olan QR'ı geri çiz (v1.5). Kod o arada dolmuşsa yenisini al —
 * süresi geçmiş bir QR'ı yeniden çizmek, üyeyi çalışmayan bir koda okutturur.
 */
static void qrGeriCiz(Kapi& k) {
  if (k.kod.length() == 6 && millis() < k.kodBitis) {
#ifdef TESHIS
    teshisCiz(k, k.kod.c_str());
#else
    uiHazir(k.yuz, k.kod);
#endif
  } else {
    kodYenile(k);
  }
}

/** Bir kapının bir turu: kodu kullanıldı mı, kullanıldıysa kolu çevir ve karşıla. */
static void kapiTuru(Kapi& k) {
  if (k.kod.length() == 6) {
    const String c = istek(k, "/api/turnstile/status", String("{\"code\":\"") + k.kod + "\"}");
    // ── UZAKTAN YENİDEN BAŞLAT (v1.4, 2026-09-14) ──────────────────────────────────────────────
    //
    // Owner: "devamlı elektriği kes demek sıkıntı." Resepsiyon panelden basar, olay sunucuda yazılır.
    // Yalnızca BU kutu yeniden başlar — turnikenin kendi kartı, kendi adaptörüyle, olduğu gibi kalır.
    // Röleler açılışta ilk iş serbest bırakıldığı için yeniden başlama kolu tetiklemez.
    if (c.indexOf("\"restart\":{") >= 0) {
      Serial.printf("[turnike:%s] UZAKTAN YENIDEN BASLATMA\n", k.ad);
      for (size_t i = 0; i < KAPI_SAYISI; i++) uiBaglaniyor(kapilar[i].yuz);
      delay(300);
      ESP.restart();
    }

    if (c.indexOf("\"crossed\":{") >= 0) {
      const String ad = alanOku(c, "firstName");
      const String kalan = alanOku(c, "kalan");
      Serial.printf("[turnike:%s] GECIS: %s\n", k.ad, ad.c_str());

      // "KONTROL EDİLİYOR" ÖNCE, ama YALNIZCA ALT ŞERİT (owner şartı: sistem cevap veriyor
      // hissi). Tam ekran çizmek 2 MHz'lik veri yolunda ~0,6 s sürüyor ve kolu o kadar
      // geciktirirdi; şerit ~0,1 s. Kol hâlâ ekrandan önce dönüyor.
      uiKontrol(k.yuz);

      // Önce kol, sonra ses, sonra ekran: üye önce kolun döndüğünü hisseder, sesi duyar, en son
      // yazıya bakar — bakarsa.
      darbe(k.rolePin);
      bip(1);

      uiBasarili(k.yuz, ad, kalan);
      // Karşılama süresi boyunca ÖBÜR kapı beklemede. İki kişinin aynı saniyede iki taraftan
      // geçmesi nadir; buna karşılık kodu basit tutmak, turnikede debug etmeyeceğimiz anlamına
      // geliyor. Sorun olursa burası bloklamayan bir zamanlayıcıya döner.
      delay(KARSILAMA_MS);

      kodYenile(k);  // kullanılan kod ölüdür, hemen yenisi
      return;
    }

    // ── PANELDEN AÇ (owner, 2026-09-01) ─────────────────────────────────────────────────────
    //
    // Resepsiyon ekrandan "Aç" dedi: misafir, kargo, ya da elinde telefonu olmayan personel. Kol
    // döner ve ekran kimseyi karşılamaz — çünkü kim geçtiğini bilmiyoruz ve bilmediğimiz bir şeyi
    // yazmak, yazmamaktan kötüdür. Kaydı sunucu tutuyor: kimin açtığı ve sebebi olayda duruyor.
    if (c.indexOf("\"open\":{") >= 0) {
      Serial.printf("[turnike:%s] PANELDEN ACILDI\n", k.ad);
      darbe(k.rolePin);
      bip(1);

      // İSİM YOK, UYDURULMUYOR: kimin geçtiğini bilmiyoruz. Ekran yalnızca kapının açıldığını
      // söylüyor — bilmediğimiz bir şeyi yazmak, yazmamaktan kötüdür.
      uiBasarili(k.yuz, "", "");
      delay(KARSILAMA_MS);
      // Kod harcanmadı: ekrandaki QR hâlâ geçerli ve bir üye onu okutabilir — o yüzden QR'ı GERİ ÇİZ.
      // v1.4'e kadar çizilmiyordu: karşılama bir sonraki kod yenilemesine (25 sn'ye kadar) ekranda kaldı
      // ve o sürede kimse okutamadı (owner, 15.09: "hoşgeldiniz çok uzun kaldı").
      qrGeriCiz(k);
      return;
    }

    // ── RET: paketi olmayan üye (owner, 2026-08-31) ─────────────────────────────────────────
    //
    // Kol DÖNMEZ. Buradaki tek iş yazıyı göstermek — `darbe()` bilerek çağrılmıyor, ve bu satırın
    // yokluğu kuralın kendisidir.
    //
    // Kod da yenilenmiyor: sunucu reddederken kodu harcamadı, üye resepsiyona uğrayıp paketini
    // yeniletince aynı ekranı okutabilmeli. Yenilesek, çalışan bir kodu boşuna çöpe atardık.
    if (c.indexOf("\"refused\":{") >= 0) {
      const String sebep = alanOku(c, "reason");
      Serial.printf("[turnike:%s] RET: %s\n", k.ad, sebep.c_str());
      bip(2);  // karşılamadan FARKLI bir ses: üye ekrana bakmadan da bir şeyin olmadığını anlar

      // TEKNİK SEBEP EKRANA YAZILMIYOR (owner şartı). Sunucu "no_active_membership" diyor;
      // kapıdaki üyeye söylenecek şey bu değil. Suçlayıcı değil, yönlendirici: kapıda kalmış
      // birine "hakkınız yok" demek hem kırıcı hem işe yaramaz; ne yapacağını söylemek yarar.
      //
      // İsim de yazılmıyor: kırmızı bir ekranın üstündeki kendi adı, üyeyi kalabalıkta teşhir
      // ediyor. Kim olduğunu zaten biliyor; bilmediği şey ne yapacağı.
      //
      // AZ ÖNCE GEÇTİNİZ (v1.5, owner 15.09): aynı kişi 45 sn içinde tekrar okutunca sunucu reddediyor.
      // Buna "resepsiyona uğrayın" demek yanlış yere yollamak olur — üyenin yapacağı tek şey beklemek.
      // Başlık kapının yönünden: çıkış kapısında "Giriş Yapılamadı" yazmak kafa karıştırır.
      if (sebep == "checkin_too_soon") {
        uiReddedildi(k.yuz, tr("Az Önce Geçtiniz").c_str(), tr("Biraz sonra tekrar deneyin").c_str());
      } else {
        const bool giris = k.yuz.mod == Mod::Giris;
        uiReddedildi(k.yuz, tr(giris ? "Giriş Yapılamadı" : "Çıkış Yapılamadı").c_str(),
                     tr("Lütfen resepsiyona uğrayın").c_str());
      }
      delay(KARSILAMA_MS);
      qrGeriCiz(k);  // ret de ekranda asılı kalmasın — kod harcanmadı, QR hâlâ geçerli
      return;
    }
  }
  if (millis() > k.kodBitis) kodYenile(k);
}

// AÇILIŞ SAYACI. Kutu kendiliğinden yeniden başlıyorsa bu sayaç sıfırlanır: seri portta "tur 60"
// yerine tekrar tekrar "tur 20" görüyorsan sorun ekranda değil, kartın yeniden başlamasındadır —
// ve o ikisi ekrandan bakınca AYNI görünür.
static uint32_t tur = 0;

// ── PROB MODU (13.09.2026, montajda) ───────────────────────────────────────────────────────
//
// `-D PROB` ile derlenir. Yaptığı tek şey: her 2 saniyede bir panelleri yeniden kurup ekranı
// boyamak, ve her turu seri porta yazmak.
//
// VARLIK SEBEBİ ANLIK GERİ BİLDİRİM. Normal çalışmada ekran 25 saniyede bir tazeleniyor; montajcı
// bir kabloya bastırdığında sonucu 25 saniye sonra görüyor ve nedenle sonucu ilişkilendiremiyor.
// İki saniyede bir çizince, doğru uca bastırdığın an ekran geliyor — ve suçlu kablo kendini
// gösteriyor. Ölçüm aleti, ürün değil.
#ifdef PROB
static void probTuru() {
  static uint32_t n = 0;
  n++;
  pinMode(PIN_RST, OUTPUT);
  digitalWrite(PIN_RST, HIGH); delay(5);
  digitalWrite(PIN_RST, LOW);  delay(20);
  digitalWrite(PIN_RST, HIGH); delay(120);
  for (size_t i = 0; i < KAPI_SAYISI; i++) {
    kapilar[i].tft->begin(2000000);
    kapilar[i].tft->setRotation(kapilar[i].rotasyon);
  }
  // Sırayla farklı renk: ekran GELDİĞİNDE donmuş bir görüntü mü yoksa canlı mı, bakışta anlaşılsın.
  const uint16_t renkler[] = { ILI9341_RED, ILI9341_GREEN, ILI9341_BLUE, ILI9341_WHITE };
  const uint16_t renk = renkler[n % 4];
  for (size_t i = 0; i < KAPI_SAYISI; i++) kapilar[i].tft->fillScreen(renk);
  Serial.printf("[prob] tur %u · renk %u · ekranlara yazildi\n", (unsigned)n, (unsigned)(n % 4));
}
#endif

// ── KENDİLİĞİNDEN YENİDEN BAŞLAMA (v1.4, 2026-09-14) ───────────────────────────────────────────
//
// 14.09'da kutu gün içinde takıldı ve elektrik kesip açmak düzeltti. Sebebi henüz bilinmiyor
// (DEBT-046); bilinene kadar kutu, bir elektrik kesintisinin yaptığını kendi yapar — ama yalnızca
// kimsenin kapıda olmadığı bir anda:
//
//   · GECE: saat 04:00–04:59, en az 2 saattir açık, son 10 dakikada geçiş yok. Günde bir kez.
//   · TAKILMA: ağ bağlı görünüyor ama 3 dakikadır tek bir başarılı cevap yok. Bu, internetin
//     kesilmesinden farklı değil — ama kesintide de yeniden başlamanın zararı yok, faydası olabilir.
//
// İkisi de WiFi BAĞLIYKEN çalışır: ağ yokken yeniden başlayan kutu kurulum moduna düşerdi.
static void kendiliginden() {
  if (WiFi.status() != WL_CONNECTED) return;
  const uint32_t simdi = millis();
  if (simdi - sonBasari > 3UL * 60 * 1000) {
    Serial.println("[turnike] 3 dk basarili cevap yok → yeniden baslatma");
    ESP.restart();
  }
  struct tm t;
  if (simdi > 2UL * 3600 * 1000 && simdi - sonHareket > 10UL * 60 * 1000 && getLocalTime(&t, 0) && t.tm_hour == 4) {
    Serial.println("[turnike] gece yeniden baslatmasi");
    ESP.restart();
  }
}

void loop() {
#ifdef PROB
  probTuru();
  delay(2000);
  return;
#endif
  if (++tur % 20 == 0)
    Serial.printf("[turnike] %s · tur %u · calisma %u sn · heap %u · wifi %s %d dBm · darbe %u · acilis %s\n",
                  FW_SURUM, (unsigned)tur, (unsigned)(millis() / 1000), (unsigned)ESP.getFreeHeap(),
                  WiFi.status() == WL_CONNECTED ? "ok" : "yok", (int)WiFi.RSSI(), (unsigned)darbeSayisi,
                  acilisSebebi());
  kendiliginden();
  for (size_t i = 0; i < KAPI_SAYISI; i++) {
    kapiTuru(kapilar[i]);
    delay(1);  // iki kapı arasında nefes: uzun çizimden sonra görev sırasını bırak
  }
  delay(SORGU_MS);
}
