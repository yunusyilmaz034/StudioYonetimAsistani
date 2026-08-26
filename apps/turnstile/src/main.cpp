// AŞAMA 2 — GERÇEK QR
//
// WiFi'ye bağlanır, sunucudan altı haneli kodu ister, ekrana QR olarak basar. Kod ömürlüdür ve
// TEK KULLANIMLIKTIR — o yüzden sürekli yenileniyor.
//
// Kodun içine sadece altı hane yazılıyor, fazlası değil: üye uygulaması QR'ın ŞEKLİNDEN hangi
// kapı olduğunu anlıyor (altı hane = turnike, uzun token = kiosk). Üyenin hangi ekrana baktığını
// bilmesi gerekmiyor; kamerayı açıyor, iki kapıda da çalışıyor.
//
// Karar burada verilmiyor. Bu cihaz kod gösterir, başka bir şey yapmaz: kimin geçebileceğine,
// kredinin düşüp düşmeyeceğine, yönün ne olduğuna sunucu karar veriyor. Duvardaki bir kutunun
// bildiği hiçbir şeye güvenilmez.
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

static Adafruit_ILI9341 tft(PIN_CS, PIN_DC, PIN_RST);

// Sunucu kodu kısa ömürlü veriyor; ondan biraz daha sık yeniliyoruz ki ekranda ölü kod durmasın.
static const uint32_t YENILEME_MS = 8000;

static void mesaj(const char* satir1, const char* satir2, uint16_t renk) {
  tft.fillScreen(ILI9341_BLACK);
  tft.setTextColor(renk);
  tft.setTextSize(2);
  tft.setCursor(12, 140);
  tft.println(satir1);
  if (satir2) {
    tft.setTextColor(ILI9341_WHITE);
    tft.setTextSize(1);
    tft.setCursor(12, 170);
    tft.println(satir2);
  }
}

static void qrCiz(const char* metin) {
  QRCode qr;
  uint8_t veri[qrcode_getBufferSize(3)];
  qrcode_initText(&qr, veri, 3, ECC_MEDIUM, metin);

  // Ekranı doldur ama kenarda beyaz boşluk bırak: sessiz alan olmadan kamera QR'ı bulamaz.
  const int modul = 240 / (qr.size + 8);
  const int kenar = (240 - qr.size * modul) / 2;
  const int ust = 30;

  tft.fillScreen(ILI9341_WHITE);
  for (uint8_t y = 0; y < qr.size; y++) {
    for (uint8_t x = 0; x < qr.size; x++) {
      if (qrcode_getModule(&qr, x, y)) {
        tft.fillRect(kenar + x * modul, ust + y * modul, modul, modul, ILI9341_BLACK);
      }
    }
  }

  tft.setTextColor(ILI9341_BLACK);
  tft.setTextSize(2);
  tft.setCursor(45, ust + qr.size * modul + 18);
  tft.println("Uygulamadan");
  tft.setCursor(75, ust + qr.size * modul + 42);
  tft.println("okutun");
}

/** Sunucudan sıradaki kodu ister. Boş dönerse çağıran ekranda ne yazacağına karar verir. */
static String kodAl() {
  if (WiFi.status() != WL_CONNECTED) return "";
  HTTPClient http;
  http.begin(String(API_BASE) + "/api/turnstile");
  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-studio-id", STUDIO_ID);
  http.addHeader("Authorization", String("Bearer ") + DEVICE_AUTH);
  http.setTimeout(8000);

  const int kod = http.POST("{}");
  const String govde = http.getString();
  http.end();

  Serial.printf("[turnike] HTTP %d  %s\n", kod, govde.substring(0, 120).c_str());
  if (kod != 200) return "";

  // Küçük ve sabit bir cevap; tam JSON ayrıştırıcı taşımaya değmez. Aradığımız altı hane.
  const int i = govde.indexOf("\"code\"");
  if (i < 0) return "";
  const int b = govde.indexOf('"', govde.indexOf(':', i)) + 1;
  const int s = govde.indexOf('"', b);
  return (b > 0 && s > b) ? govde.substring(b, s) : "";
}

void setup() {
  Serial.begin(115200);
  delay(300);
  Serial.println("\n[turnike] aciliyor");

  pinMode(PIN_LED, OUTPUT);
  digitalWrite(PIN_LED, HIGH);
  SPI.begin(PIN_SCK, -1, PIN_MOSI, PIN_CS);
  tft.begin(2000000);
  tft.setRotation(0);

  mesaj("WiFi...", WIFI_SSID, ILI9341_YELLOW);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  for (int i = 0; i < 40 && WiFi.status() != WL_CONNECTED; i++) {
    delay(500);
    Serial.print('.');
  }
  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("[turnike] baglandi: %s\n", WiFi.localIP().toString().c_str());
    mesaj("Baglandi", WiFi.localIP().toString().c_str(), ILI9341_GREEN);
  } else {
    Serial.println("[turnike] WiFi YOK");
    mesaj("WiFi yok", WIFI_SSID, ILI9341_RED);
  }
  delay(1200);
}

void loop() {
  const String kod = kodAl();
  if (kod.length() > 0) {
    Serial.printf("[turnike] kod: %s\n", kod.c_str());
    qrCiz(kod.c_str());
  } else {
    // Eski kodu ekranda BIRAKMIYORUZ: süresi geçmiş bir QR, üyeyi çalışmayan bir şeye okutur ve
    // hatanın kendisinde olduğunu düşündürür.
    mesaj("Baglanti yok", "birazdan tekrar denenecek", ILI9341_RED);
  }
  delay(YENILEME_MS);
}
