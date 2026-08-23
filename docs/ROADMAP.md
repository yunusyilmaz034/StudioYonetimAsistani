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

## FAZ 3 — 💜 Kadın Sağlığı Modülü (owner onaylı 2026-08-23, sırası sonra kararlaştırılacak)

**Owner'ın sorusu:** "İnsanlar uygulamamızı sadece bize abone oldukları için indirmemeli — kadınlara
ait spora dair ne varsa içinde olsa." Araştırıldı, ve stratejisi **B2C'ye çıkmak değil**: üye
uygulamasını o kadar iyi yapmak ki **stüdyolar OS'u ONUN için alsın.** Bugün edinme maliyeti sıfır
(üye stüdyo söylediği için indiriyor); tüketici pazarına çıkmak o sıfırı satın almaya çevirir, ve
Nike + Pepapp + altı kalori uygulamasıyla dövüşmek demektir.

**Neden bunu kimse yapamaz:** genel uygulamalar kullanıcının BEYANINA dayanır. Bu uygulama gerçekten
ne olduğunu **bilir** — kaç kez geldi, aylık yağ-kas ölçümü ne çıktı, Işıl ona ne yazdı. Rakiplerde
bu veri yok, ve toplayamazlar.

**Reddedilenler ve sebepleri.** *Fal / İslami fizyonomi:* çekim gücü gerçek (Faladdin+Binnaz 25M
indirme, %85 kadın) ama sağlık markasını zehirler, falcılık İslami literatürde yaygın olarak haram
sayıldığı için hedef kitleyi iter, ve o iki uygulamaya soruşturma açıldı. *Fotoğraftan kalori:*
emtia — Calfy, Foto Kalori, Kaçıyor (2.700+ Türk yemeği), NeYedim zaten var. Özellik olabilir,
başlık olamaz.

### Kesişen mimari kural — nerede durur

> **Üyenin bedenine ait veri telefonunda kalır. Stüdyoya ait veri sunucuda kalır.**

Döngü verisi ve ilerleme fotoğrafları **sunucuya hiç gitmez** — şifreli değil, HİÇ. Sonucu: Işıl
göremez, veritabanı sızsa orada yoktur, ve işlemediğimiz özel nitelikli veriden sorumlu değiliz.
En güvenli yol aynı zamanda en ucuz yol.

**İstisna hamilelik:** stüdyonun programı uyarlayabilmesi için bilmesi *gerekir*. Orada seçim üyenin,
ve bedeli açıkça söylenir: "paylaşırsan program sana göre yazılır, paylaşmazsan değişmez." Paylaşırsa
açık rıza kaydıyla sunucuya yazılır.

### 3.1 · 🤰 Hamilelik & doğum sonrası — **önce bu çıkar**

Öne alınmasının sebebi ticari: **kadın stüdyosunda kalıcı üye kaybının bir numaralı sebebi
hamilelik.** Üye dondurur, kaybolur, dönmek istediğinde "yapabilir miyim, nereden başlarım" diye
düşünüp hiç başlamaz. Diğer maddeler yeni üye çeker; bu **elindekini tutar** — ve tutmak çekmekten
ucuzdur. Ayrıca doğum sonrası hareket içeriği Türkçe'de neredeyse yok; boşluk en büyük burada.

Duygusal kayıt farklı: her yerde soru "ilerliyor muyum", burada **"güvende miyim"**.

**Hamilelik:** haftaya göre çalışan her şey (TDT girilir) · "bu hafta ne değişti" kartı · hareket
kütüphanesi haftaya göre filtreli, Işıl'ın anlatımıyla (ör. 16h+ sırtüstü yerine yan yatış) ·
**pelvik taban günde 5 dk** (en yüksek değerli parça, Türkiye'de kimse düzgün anlatmıyor) · kırmızı
bayraklar her ekrandan tek dokunuş (kanama, kasılma, su gelmesi, hareket azalması → "dur, doktoruna
ulaş") · 32h+ doğuma hazırlık · nefes/sakinleşme.

**Doğum sonrası:** **doktor onayı bir KAPI, öneri değil** (6 hafta / sezaryen 8) · **rektus diastazı
kendi kendine testi** — ayrılık varsa belirli hareketler kilitli kalır; kadınların çoğu bunu bilmiyor
ve mekik/plank yapıp kalıcı kötüleştiriyor, bu tek özellik ağızdan ağıza yayar · kademeli dönüş
(nefes → derin karın → pelvik taban → yüklenme) · **sezaryen ayrı yol** · emzirme + bebekle gelme.

**Panel:** üye kartında hamilelik + hafta (Işıl ve eğitmen görür) · uygun olmayan derse yazarken
uyarı · tek dokunuş dondurma · **doğumdan ~10 hafta sonra dönüş hatırlatması** ("ne zaman istersen
buradayız") — ticari olarak en değerli mesaj, çoğu stüdyo bu üyeyi sonsuza kadar kaybediyor.

**İlk üç ay özel:** kadınların çoğu ilk trimesterda kimseye söylemiyor. Uygulama "henüz paylaşma"
durumunda tek başına yol gösterebilmeli.

**Yapmayacaklarımız:** bebek boyu karşılaştırması ("artık bir avokado kadar") · hamilelikte beslenme
reçetesi (doktorun işi, sorumluluk) · **"bu senin için güvenli" cümlesi** — uygulama "genelde şöyle
uyarlanır, kararı doktorun verir" der. Fala "uyduruyor" dedik, kendi ürünümüzde de aynı çıta.

**Kapsam:** hamilelik uygulaması yapmıyoruz, bir hamilelik uygulamasının **hareket yarısını**
yapıyoruz.

### 3.2 · 🩸 Döngü modu

Pazar 2 → 7,7 milyar $ (yıllık %18). Türkiye'de regl **takip eden** var (Pepapp); regl'e göre
**antrenman veren yok.**

**Kritik dürüstlük notu:** "foliküler fazda ağır çalış, luteal fazda hafifle" iddiasının bilimsel
dayanağı **zayıf**. O yüzden **reçete yazmıyoruz, örüntü gösteriyoruz**: üye her dersten sonra tek
dokunuşla "bugün nasıldı" der (zor/normal/iyi), uygulama bunu döngüsüyle eşleştirir ve **kendi
verisinden** söyler: *"son 3 ayda regl öncesi haftalarda derslerini 'zor' işaretlemişsin — bu hafta o
dönemdesin, kendine yüklenme."* Tahmin değil, onun kendi verisi; çürütülemez.

Cevapladığı soru: *"neden bu hafta bu kadar zorlandım, bir şey mi yanlış yapıyorum?"* Cevap "sen
başarısız olmadın" olduğunda o üye uygulamayı silmez. Fal uygulamalarının sattığı "bana özel bir şey
söylüyor" hissinin doğru versiyonu.

Uygulama Işıl'ın programını sunucudan alır, döngü bilgisini telefonda tutar, **ikisini telefonda
birleştirir.** Sunucu kimin ne zaman regl olduğunu hiç bilmez.

### 3.3 · 📏 Ölçüm zaman tüneli

Stüdyo **zaten her ay** yağ-kas ölçüyor ve bu hiçbir yerde gösterilmiyor. Yeni veri toplamıyoruz,
sahip olduğumuzu görünür kılıyoruz.

**Rakam merkezde, fotoğraf en dış halka.** Before/after kartı rakamla: *"3 ayda −4 cm bel, −3,1 kg
yağ, +1,2 kg kas"* — içinde vücut yok, başarı var, o yüzden **paylaşılabilir** (ve o paylaşım en iyi
reklam). Fotoğraf çekmeyen üye özelliğin tamamını kullanır.

**Fotoğraf isteğe bağlı, ve yedi kural onu inandırır** (owner: "mahremiyet yüzünden sıcak
bakmayabilirler"): **telefonun galerisine kaydolmaz** ← en önemlisi, çünkü asıl korku sunucu değil,
eşinin/çocuğunun galeriye bakması · yüz çerçeve dışında · silüet modu · Face ID/parmak izi ile ayrıca
kilitli · iCloud/Google'a yedeklenmez · "sil" gerçekten siler · **ve ekran bunu çekim anında kendisi
söyler** (politika sayfasında değil).

**Hayalet çerçeve:** yeni fotoğrafta öncekinin soluk hattı görünür, üye ona hizalanır. Before/after'ı
gerçekten kıyaslanabilir yapan şey bu; olmadan özellik amatör kalır.

**Dürüst bedel, baştan söylenir:** telefon değişirse fotoğraflar gider. Şifreli yedek v1'e girmez.

### Sonraki tur (bu fazda değil, sırada)
Menopoz dönemi (daha da boş alan, ödeme gücü yüksek kitle) · evde mini programlar (Işıl'ın sesiyle,
gelemediği günler — iptali azaltır) · topluluk & meydan okuma ("Ağustos'ta 12 ders", devam serisi) ·
beslenme günlüğü (emtia; "kalori sayacı" değil "günlük" dili — kalori/kilo odaklı kurgu kadın
kitlesinde yeme bozukluğu riski taşır).

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

---

## Ürünleştirme (çok müşterili SaaS) — ayrı dokümanda

Sistemi başka stüdyolara **yıllık lisansla** satma yolu: **[`PRODUCT-ROADMAP.md`](PRODUCT-ROADMAP.md)**.
Karar: tek kod tabanı, müşteri = yeni `studioId`. Ölçüldü (2026-07-26): kodda sabit stüdyo izi yok,
ödeme/tema/katalog/AI/şablonlar zaten stüdyo başına; eksik olan WhatsApp numarası ve e-posta göndericisi.
Owner: **acele yok** — önce PF/bug işleri.
