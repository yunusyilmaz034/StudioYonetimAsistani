#pragma once
#include <Adafruit_ILI9341.h>
#include <Arduino.h>

// ── TURNİKE EKRAN KATMANI (owner tasarımı, 2026-09-08) ──────────────────────────────────────
//
// Bu dosya YALNIZCA çizer. Ağ, QR üretimi, röle, buzzer ve turnike mantığı `main.cpp`te kalır ve
// buraya hiç sızmaz — ekran bir sonuç gösterir, hiçbir karar vermez. Ayrımın sebebi pratik: ekranı
// değiştirmek kapıyı bozmamalı, ve bu kartta her firmware denemesi turnikenin başına gitmek demek.
//
// İKİ EKRAN TEK SİSTEM. Giriş ve çıkış aynı fonksiyonları çağırır; farkı yalnızca `Mod` taşır. İki
// ayrı çizim yolu olsaydı, biri düzeltilip öbürü unutulurdu — bu projede o hata bu hafta dört kez
// çıktı.
//
// TÜRKÇE. Metinler `tr()` ile tek bayta indirgeniyor çünkü Adafruit'in print yolu `uint8_t` taşıyor;
// 0xFF üstü bir kod noktası oradan geçemez. Fontun içinde Türkçe glifler, Türkçe metinde asla
// geçmeyen Latin-1 yuvalarına yerleştirildi (`tr_fonts.h`). Önceki sürüm bunun yerine ismi ASCII'ye
// düşürüyordu ve kapıda üyeye "Hos geldin SULE GURSES" diyordu.

enum class Ekran : uint8_t { Yok, Baglaniyor, Hazir, Kontrol, Basarili, Reddedildi };
enum class Mod : uint8_t { Giris, Cikis };

/** Bir ekranın çizim durumu. `main.cpp` bunu kapı yapısında taşır; UI başka hiçbir şey bilmez. */
struct Yuz {
  Adafruit_ILI9341* tft;
  Mod mod;
  Ekran ekran;  // Ekran::Yok ile başlatılır
  String kod;   // Hazır ekranında çizili olan kod — değişmediyse QR yeniden çizilmez
};

void uiBaglaniyor(Yuz& y);
void uiHazir(Yuz& y, const String& kod);
void uiKontrol(Yuz& y);
void uiBasarili(Yuz& y, const String& ad, const String& kalan);
void uiReddedildi(Yuz& y, const char* baslik, const char* alt);

/** UTF-8 Türkçe → fontun tek baytlık yuvaları. Bilinmeyen çok baytlı karakter atlanır. */
String tr(const String& s);

/**
 * KURULUM EKRANI. Ağ adı, şifre ve adres — yani normal çalışmada YASAK olan her şey.
 *
 * Yasağın sebebi bilginin kendisi değil, izleyicisiydi: koridordaki üye için IP bir gürültüdür.
 * Kurulum modunda ekranın karşısındaki kişi montajcıdır ve o bilgiler onun işidir.
 */
void uiKurulum(Yuz& y, const char* baslik, const char* alt1, const char* alt2);
