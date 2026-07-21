# Yol Haritası — 2026 (owner onaylı, yaşayan doküman)

**Çalışma tarzı.** Roadmap'te ilerle. **Bug gelince her şeyi bırak → acil hotfix çık, main'e ver →
sonra kaldığın yerden devam et.** Blok blok commit + push. (Doc 10 · [[bug-hotfix-feature-workflow]])

Önceki roadmap (Doc 32 Product-Plus, 10 faz) TAMAMLANDI. Bu, ondan sonraki yeni yol haritası.

---

## FAZ 1 — yakın vade (somut, bounded)

### 1a · Sanal POS (PAYTR iFrame/Direct API) · money-critical
Resepsiyon ödemeyi alırken "KK"ye **ek olarak "Sanal POS"** seçeneği → form açılır → müşterinin
**taksit tablosu** gösterilir → **3D Secure** ile ödeme alınır. Link ödeme (Link API) zaten var; bu
**iFrame API** — ayrı PAYTR ürünü, ek anlaşma yapıldı.
- **Mimari:** mevcut PAYTR seam'ini büyütür (PAYTR_SECRETS, callback, PaymentIntent). iFrame token
  üretimi + 3D akışı + callback doğrulama. Para yolu → yavaşla, tahminle yazma.
- **BLOKER:** dev.paytr.com iFrame API dökümanı (owner gönderecek). Gelmeden başlanmaz.

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

### 2.1 · 🤖 AI Resepsiyonist (en yüksek büyüme değeri)
Reklamlardan WhatsApp API'mize düşen lead ile **resepsiyon personeli gibi konuşan**, her şeye hâkim,
sıkışınca/yanıtlayamayınca **operatöre yönlendiren** AI. Satış hunisi (CRM) bununla canlanır.
- **Gerekli altyapı:** WhatsApp **GELEN mesaj webhook'u** (şu an sadece giden/şablon var) + gerçek AI
  API (Claude) + konuşma hafızası/state + operatöre devir (escalation) + lead → CRM akışı.

### 2.2 · 📊 AI Patron Asistanı
Satış grafiği, reklam afişi metni + zaman/dönem önerisi, kampanya önerisi, personel takibi/raporlama,
dükkan açılış/kapanış protokolleri. Ürün vizyonundaki "AI Insights"ın genişlemiş hali; **event verisi
biriktikçe** güçlenir (check-in/yoklama kullanımı şart).

### 2.3 · 🏠 Home Assistant (IoT) entegrasyonu
Klima, kapı/pencere açık, içeride insan var, su vanası, ışık, havalandırma — otonom işler panelden.
"Tam patron komuta merkezi". HA'nın REST/WebSocket API'si üzerinden. Kapsam kararı (studio OS mü,
komuta merkezi mi) + ayrı bir dünya → Faz 2'nin sonunda.

### 2.4 · 📹 NVR / Kamera entegrasyonu
CCTV'den: personel/müşteri, kasada kim ne kadar kaldı, dwell-time raporları.
- **⚠️ KVKK AĞIR:** personel + müşteri görüntü kaydı, saklama, rıza, aydınlatma — önden hukuki çerçeve
  konuşulmalı. Teknik olarak da büyük (NVR API + görüntü analizi).

---

## Sıra (owner, 2026-07-21)
1. **Faz 1b (üye mobil)** — ŞİMDİ başlandı (harici bağımlılık yok).
2. **Faz 1a (Sanal POS)** — owner iFrame dökümanını gönderince.
3. **Faz 2** — Faz 1 bitince, her biri ayrı ayrı scope edilerek. Muhtemel sıra: AI Resepsiyonist →
   AI Patron Asistanı → NVR (KVKK sonrası) → Home Assistant.
