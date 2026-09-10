#include "provision.h"

#include <DNSServer.h>
#include <Preferences.h>
#include <WebServer.h>
#include <WiFi.h>

static const char* NVS_AD = "turnike";
// Kurulum ağının şifresi SABİT ve firmware'de: bu ağ yalnızca kurulum sırasında, montajcının
// yanındayken, birkaç dakika açık kalıyor. Rastgele bir şifre üretmek onu ekrana yazmayı
// gerektirirdi ve ekranın çözünürlüğü sınırlı; sabit şifre burada tehdit modeline uygun.
static const char* AP_SIFRE = "kurulum1234";

Ayar ayarOku() {
  Preferences p;
  Ayar a;
  if (!p.begin(NVS_AD, /*readOnly=*/true)) return a;
  a.ssid = p.getString("ssid", "");
  a.sifre = p.getString("sifre", "");
  a.authGiris = p.getString("authg", "");
  a.authCikis = p.getString("authc", "");
  p.end();
  return a;
}

void ayarYaz(const Ayar& a) {
  Preferences p;
  if (!p.begin(NVS_AD, /*readOnly=*/false)) return;
  p.putString("ssid", a.ssid);
  p.putString("sifre", a.sifre);
  p.putString("authg", a.authGiris);
  p.putString("authc", a.authCikis);
  p.end();
}

/** HTML kaçışı: ağ adında `"` ya da `&` geçen bir ev, sayfayı bozmasın. */
static String kacir(const String& s) {
  String o;
  for (size_t i = 0; i < s.length(); i++) {
    const char c = s[i];
    if (c == '&') o += "&amp;";
    else if (c == '<') o += "&lt;";
    else if (c == '>') o += "&gt;";
    else if (c == '"') o += "&quot;";
    else o += c;
  }
  return o;
}

void kurulumModu(void (*ekranaYaz)(const char*, const char*, const char*)) {
  // Kurulum ağının adı KARTA ÖZEL: aynı binada iki kart varsa montajcı hangisine bağlandığını
  // bilmeli. MAC'in son üç baytı yeter ve ekrandaki adla birebir aynı.
  uint8_t mac[6];
  WiFi.macAddress(mac);
  char apAd[32];
  snprintf(apAd, sizeof(apAd), "Turnike-Kurulum-%02X%02X%02X", mac[3], mac[4], mac[5]);

  WiFi.mode(WIFI_AP_STA);
  // ÖNCE TARA, sonra AP'yi aç: AP açıkken tarama bazı çekirdeklerde boş liste döndürüyor ve
  // montajcıya "ağ yok" gibi görünüyor.
  const int bulunan = WiFi.scanNetworks();
  WiFi.softAP(apAd, AP_SIFRE);
  const IPAddress ip = WiFi.softAPIP();

  char ipYazi[24];
  snprintf(ipYazi, sizeof(ipYazi), "%s", ip.toString().c_str());
  ekranaYaz(apAd, AP_SIFRE, ipYazi);
  Serial.printf("[kurulum] AP: %s / %s → http://%s\n", apAd, AP_SIFRE, ipYazi);

  // Yakalayıcı portal: hangi adrese giderse gitsin kurulum sayfası açılır. Montajcıya IP
  // yazdırmak, ekranı okuyup telefona doğru yazmasını beklemektir; DNS bunu gereksiz kılıyor.
  DNSServer dns;
  dns.start(53, "*", ip);

  WebServer http(80);
  bool kaydedildi = false;

  http.on("/", [&]() {
    String h = F("<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'>"
                 "<style>body{font-family:system-ui;background:#0A0E1A;color:#fff;margin:0;padding:20px}"
                 "h1{font-size:19px;margin:0 0 4px}p{color:#94A3B8;font-size:13px;margin:0 0 18px}"
                 "label{display:block;font-size:12px;color:#94A3B8;margin:14px 0 4px}"
                 "input,select{width:100%;box-sizing:border-box;padding:11px;border-radius:9px;border:1px solid #24304a;background:#111827;color:#fff;font-size:15px}"
                 "button{width:100%;margin-top:22px;padding:14px;border:0;border-radius:9px;background:#22D3EE;color:#04121a;font-size:16px;font-weight:700}"
                 "</style><h1>Turnike kurulumu</h1><p>Ağı seç, panelden aldığın anahtarları yapıştır.</p>"
                 "<form method=POST action=/kaydet><label>WiFi ağı</label><select name=ssid>");
    for (int i = 0; i < bulunan; i++) {
      const String s = WiFi.SSID(i);
      if (s.length() == 0) continue;
      h += "<option value=\"" + kacir(s) + "\">" + kacir(s) + "</option>";
    }
    h += F("</select><label>WiFi şifresi</label><input name=sifre type=password>"
           "<label>Giriş ekranı anahtarı</label><input name=authg placeholder='dev_....' autocapitalize=off autocorrect=off>"
           "<label>Çıkış ekranı anahtarı</label><input name=authc placeholder='dev_....' autocapitalize=off autocorrect=off>"
           "<button type=submit>Kaydet ve yeniden başlat</button></form>");
    http.send(200, "text/html; charset=utf-8", h);
  });

  http.on("/kaydet", HTTP_POST, [&]() {
    Ayar a;
    a.ssid = http.arg("ssid");
    a.sifre = http.arg("sifre");
    a.authGiris = http.arg("authg");
    a.authCikis = http.arg("authc");
    if (a.ssid.length() == 0) {
      http.send(400, "text/html; charset=utf-8", F("<meta charset=utf-8>Ağ seçilmedi. <a href=/>Geri</a>"));
      return;
    }
    ayarYaz(a);
    kaydedildi = true;
    http.send(200, "text/html; charset=utf-8",
              F("<meta charset=utf-8><body style='font-family:system-ui;background:#0A0E1A;color:#34D399;padding:24px'>"
                "<h2>Kaydedildi</h2><p style='color:#94A3B8'>Kart yeniden başlıyor. Bu ağ kapanacak.</p>"));
  });

  // Telefonların "internet var mı" yoklamaları da kurulum sayfasına gitsin — yoksa iOS/Android
  // ağı "internetsiz" sayıp arka plana atıyor ve montajcı sayfayı hiç göremiyor.
  http.onNotFound([&]() {
    http.sendHeader("Location", String("http://") + ip.toString(), true);
    http.send(302, "text/plain", "");
  });

  http.begin();
  while (true) {
    dns.processNextRequest();
    http.handleClient();
    if (kaydedildi) {
      delay(600);  // tarayıcı "Kaydedildi" sayfasını alsın, sonra hat kopsun
      ekranaYaz("Kaydedildi", "yeniden baslatiliyor", "");
      delay(900);
      ESP.restart();
    }
    delay(2);
  }
}
