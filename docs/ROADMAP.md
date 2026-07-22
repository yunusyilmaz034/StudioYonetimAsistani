# Yol Haritası — 2026 (owner onaylı, yaşayan doküman)

**Çalışma tarzı.** Roadmap'te ilerle. **Bug gelince her şeyi bırak → acil hotfix çık, main'e ver →
sonra kaldığın yerden devam et.** Blok blok commit + push. (Doc 10 · [[bug-hotfix-feature-workflow]])

Önceki roadmap (Doc 32 Product-Plus, 10 faz) TAMAMLANDI. Bu, ondan sonraki yeni yol haritası.

---

## FAZ 1 — yakın vade (somut, bounded)

### 1a · Sanal POS (PAYTR iFrame) · money-critical · ✅ BİTTİ (push edildi)
Resepsiyon ödemeyi alırken "KK"ye **ek olarak "Sanal POS"** seçeneği → form açılır → müşterinin
**taksit tablosu** gösterilir → **3D Secure** ile ödeme alınır. Link ödeme (Link API) zaten var; bu
**iFrame API** — ayrı PAYTR ürünü, ek anlaşma yapıldı.
- **Keşif:** iFrame'in tüm para makinesi ZATEN kuruluydu (`createPosSession`/`flow:'pos'` token,
  `verifyCallback` iFrame hash dalı, purpose-bazlı settlement, dialog'da "Sanal POS" seçeneği). Tek
  eksik: form yeni sekmede açılıyordu.
- **Yapıldı (commit `3c45c80`):** `paytr-sale-dialog.tsx` `flow:'pos'` artık formu **panele gömülü
  iframe**'de açıyor (taksit tablosu + 3D), sonucu intent durumundan poll ediyor, onaylanınca paket
  atanıp ekran yenileniyor. **Tamamen ek — Link akışı ve para yolu değişmedi.** CSP değişikliği yok.
- **Kalan:** owner'ın gerçek ilk Sanal POS ödemesiyle canlı testi (test_mode=0 → gerçek çekim;
  isterse geçici test_mode+test kartı). "Sanal POS aktif" ayarı açık olmalı; global Bildirim URL
  zaten fonksiyona bakıyor.

### 1b · Üye mobil — premium görünüm + Ajanda + banner + iletişim
- **Ajanda** tek karışık sekme yerine **"Rezervasyonlarım"** (mevcut/geçmiş rezervasyonlar) +
  **"Rezervasyon Yap"** (uygun seansları gör + rezervasyon) olarak ikiye bölünür.
- Genel **premium görünüm** cilası (Apple/Linear çıtası, [[premium-design-language]]).
- **Çoklu banner (carousel):** anasayfadaki banner çoklu olsun, **admin panelden yönetilsin**, sağa-sola
  kaydırılabilsin, basınca **küçük detay sayfası** (görsel + metin + iletişim). Şu an tek banner var
  (mobile-settings) → çoğula çevrilecek + admin CRUD.
- **İletişim:** uygulamada hiçbir yerde iletişim yok → **Profil altına** (ya da uygun bir yere) telefon/
  adres/harita/WhatsApp ekle (CompanyInfo zaten panelde var).
- **Not:** apps/mobile standalone (npm, pnpm check dışı). Değişiklikler EAS build ile canlıya iner.

---

## FAZ 2 — stratejik vizyon (her biri AYRI, büyük proje; sırası gelince tek tek scope edilir)

### 2.1 · 🤖 AI Resepsiyonist · ✅ BİTTİ (canlı)
Reklamlardan WhatsApp API'mize düşen lead ile **resepsiyon personeli gibi konuşan**, her şeye hâkim,
sıkışınca/yanıtlayamayınca **operatöre yönlendiren** AI. Satış hunisi (CRM) bununla canlandı.
- **Yapıldı:** WhatsApp GELEN webhook (`whatsapp-webhook.ts`) + Claude + konuşma hafızası +
  `[[DEVRET]]` operatör devri + lead skoru (`##SKOR: sıcak/ılık/soğuk`) → CRM (`lead.captured`).
  Operatör dock (sayfa geçişinde ölmez) + "Sohbetler" ekranı + Ayarlar → AI bilgi/üslup kartı.
  Fiyat/program LIVE catalog'dan, üye adı AI'a gitmez (PII), `conversations` serverOnly.
- **Ekstra (aynı fazda):** dashboard "Bugün İlgilenmen Gerekenler" AI checklist (10/14/19 slot,
  gruplama) · **AI Rapor** huni (`/ai-report`) · **AI Program Üreticisi** (havuza kilitli).
- **Kalan (operasyonel):** WhatsApp işletme adı+logo (Meta Manager) · üye WhatsApp opt-in yayılımı.

### 2.2 · 📊 AI Patron Asistanı · ✅ BİTTİ (canlı)
İşletmeyi tanıyan, **gerçek rakamlarla** soru cevaplayan sohbet + **haftalık patron brifingi** +
**tek-tık aksiyonlar** (borç hatırlatma / yenileme / kaçan üye dönüşü / kampanya taslağı).
- **Yapıldı:** deterministik snapshot (owner dashboard + aylık ciro trendi + lead sinyali) → Claude
  (rakam UYDURMAZ, isim token'lı) → `/patron` sohbet + haftalık cache'li brifing. Aksiyonlar sabit
  kayıttan; kitle snapshot'tan; owner onaylı gönderim mevcut denetimli `sendEngagementAction` hattından.
- **Sonraki genişleme (event verisi biriktikçe):** reklam afişi metni + dönem önerisi, personel
  takibi/raporlama, açılış/kapanış protokolleri. Ayrı bloklar olarak eklenir.

### 2.3 · 🏠 Home Assistant (IoT) entegrasyonu
Klima, kapı/pencere açık, içeride insan var, su vanası, ışık, havalandırma — otonom işler panelden.
"Tam patron komuta merkezi". HA'nın REST/WebSocket API'si üzerinden. Kapsam kararı (studio OS mü,
komuta merkezi mi) + ayrı bir dünya → Faz 2'nin sonunda.

### 2.4 · 📹 NVR / Kamera entegrasyonu
CCTV'den: personel/müşteri, kasada kim ne kadar kaldı, dwell-time raporları.
- **⚠️ KVKK AĞIR:** personel + müşteri görüntü kaydı, saklama, rıza, aydınlatma — önden hukuki çerçeve
  konuşulmalı. Teknik olarak da büyük (NVR API + görüntü analizi).

---

## Sıra (owner, güncel 2026-07-22)
1. **Faz 1b (üye mobil)** — ✅ BİTTİ, push + iOS build TestFlight'ta.
2. **Faz 1a (Sanal POS)** — ✅ BİTTİ, push edildi. Kalan: owner canlı test.
3. **Faz 2.1 (AI Resepsiyonist)** — ✅ BİTTİ, canlı (+ AI Rapor + AI Program + checklist).
4. **Faz 2.2 (AI Patron Asistanı)** — ✅ BİTTİ, canlı.
5. **Şimdi sıradaki aday işler (owner kararı bekliyor):**
   - **A) Operasyonel kapanış & canlı test** — WhatsApp adı+logo, iOS App Store onayı/v1.0.1,
     Sanal POS gerçek çekim testi, yeni AI özelliklerinin sahada denenmesi + ince ayar.
   - **B) AI Patron Asistanı v2** — reklam metni/dönem önerisi, personel raporu, protokoller.
   - **C) Faz 2.4 NVR / Kamera** — KVKK hukuki çerçeve ÖNCE, sonra teknik.
   - **D) Faz 2.3 Home Assistant (IoT)** — komuta merkezi; kapsam kararı gerekiyor.
