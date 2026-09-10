#pragma once
#include <Arduino.h>

// ── KURULUM MODU: WiFi VE KİMLİK CİHAZIN ÜSTÜNDEN (owner onayı, 2026-09-11) ─────────────────
//
// Bugüne kadar SSID, şifre ve iki cihaz sırrı `secrets.h`e yazılıp flash'lanıyordu. Yani her
// kurulum bir Mac, bir yazılımcı ve bir gece demekti — `TURNSTILE-HARDWARE.md` §5'in ilk maddesi.
//
// ── KAYNAK SIRASI, VE NEDEN BU SIRA ─────────────────────────────────────────────────────────
//
//   1. NVS (kartın kalıcı hafızası) — kurulumda telefondan girilen değerler
//   2. `secrets.h` — derlemeye gömülü değerler
//   3. Kurulum modu — kart kendi erişim noktasını açar
//
// `secrets.h` KALDIRILMADI ve bu bilinçli: duvardaki çalışan ünite `turnike-v1.2` ile ayakta ve
// onun NVS'i boş. Fallback olmasaydı bu firmware o kartta doğrudan kurulum moduna düşerdi — yani
// çalışan bir kapıyı, çalışmayan bir kapıya çevirirdik. Yeni ünitelerde `secrets.h` boş bırakılır
// ve zincir kendiliğinden 3'e iner.
//
// ── KURULUM EKRANI TEKNİK BİLGİ GÖSTERİR, VE GÖSTERMELİ ─────────────────────────────────────
//
// Normal çalışmada ekranda IP, SSID, HTTP kodu YASAK — orada duran kişi üyedir. Kurulum modunda
// orada duran kişi montajcıdır ve tam olarak o bilgilere ihtiyacı vardır. İkisi farklı ekran,
// farklı izleyici, farklı kural.

struct Ayar {
  String ssid;
  String sifre;
  String authGiris;  // "dev_xxx.sır" — panelden bir kez alınır
  String authCikis;
};

/** NVS'ten oku. Yoksa alanlar boş döner. */
Ayar ayarOku();

/** NVS'e yaz. Yalnızca kurulum modu çağırır. */
void ayarYaz(const Ayar& a);

/**
 * Kurulum modu: kart kendi erişim noktasını açar ve BLOKLAR.
 *
 * Dönmez — kaydedilen ayarlardan sonra kart yeniden başlar. Yarı yapılandırılmış bir kutunun
 * çalışmaya devam etmesi, montajcıya "oldu galiba" dedirtir ve o gece orada bitmez.
 *
 * `ekranaYaz` çağıranın verdiği çizim işlevi: bu dosya ekranı tanımıyor, ve tanımamalı.
 */
void kurulumModu(void (*ekranaYaz)(const char* baslik, const char* alt1, const char* alt2));
