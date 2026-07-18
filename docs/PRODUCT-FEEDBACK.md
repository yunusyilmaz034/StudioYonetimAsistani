# Product Feedback — Pilot

The single list for everything that surfaces while Işıl and the owner run the real studio on v1.0.0:
bugs, UX problems, operational gaps, speed ideas, new needs. The roadmap does NOT change; these
accumulate here and are triaged into V2 after the pilot. Each item: what · why · proposed fix · status.

Status: `backlog` (recorded, do later) · `in-progress` · `done` (struck through, kept for the record).

## Pilot Batch — kapandı (2026-07-16, tek deploy)
**✅ done:** PF-1 (Ürün Sat ekranı) · PF-2/3/4/5/6 · PF-7 (Ayarlar Kaydet barı) · PF-8 (ikon tooltip, aria-label→title) ·
PF-9 (KVKK → Ayarlar/Gizlilik) · PF-10 (üye/portal tab responsive) · PF-11 (egzersiz rehberi görünümü + içerik seed;
görseller+yapısal kas ertelendi) · PF-12 (Tema editörü: renk+font+size, presets-first) · PF-13 (takvim seans renk) ·
PF-14 (Ürün Sat kasa seçici/bug) · PF-16 (toast top-center) · PF-17 (toplu gönderim sebep+guard).
**⏸ ertelendi (insan kararı):** PF-15 (kasa rename/sil → yeni event tipi gerekir).

## PF-22 — WhatsApp bildirimleri + anti-spam stratejisi · 🟡 `owner'da (Meta kurulumu)`
2026-07-17 · owner ("en önemli konu; whatsapp ile bildir, ama spama düşme; üst üste/toplu gönderme;
sen araştır + her şeyi hazırla"). BULGU: anti-spam motoru **zaten kurulu** (üye opt-in default OFF,
marketing→kampanya izni/KVKK, sessiz saat, günlük tavan, toplu→tek mesaj), Meta Cloud API transport
mock olarak hazır. Araştırma + tam onboarding + strateji + 17 şablon içeriği → **`docs/WHATSAPP-SETUP.md`**.
Derin anti-spam tasarımı (üye başına frekans tavanı + min aralık, toplu pacing ≤40/saat, olay-bazlı
izin listesi, ≤2/hafta pazarlama, kalite izleme) dokümanda — canlıya geçişte/owner parametre onayında
uygulanacak. **ENGEL owner'da:** Meta Business+WABA, özel numara, işletme doğrulama, 17 şablon onayı,
kimlik bilgileri (Secret Manager'a — sohbete değil). + 2 karar: opt-in default, hangi olaylar WhatsApp'a.

## PF-21 — Üye e-postalarını markala + yol tarifi butonu · ✅ `done`
2026-07-17 · owner. E-posta çok sade, "nereden geldiği" belli değil. İstenen: stüdyo kimliği (kimden),
sıcak bir imza ("… ekibi olarak her zaman yanınızdayız"), ve adres/harita — "Yol tarifi al" butonu
(owner'ın linki: maps.app.goo.gl/7z3KrAKm7HY5N8cf6). Yapıldı: `renderEmailHtml` başlıkta stüdyo adı +
altta sıcak imza + adres + "📍 Yol tarifi al" butonu; hepsi **stüdyo ayarından** (CompanyInfo.mapsUrl
yeni alan, Ayarlar › Genel'de düzenlenir — kodda literal YOK, çok kiracılı). Otomatik e-postalar
(functions) markalı; retro'nun mapsUrl'i set edildi.

## PF-20 — Canlı akış'ı dashboard'dan hover-menüye taşı · ✅ `done`
2026-07-17 · owner. Genel Görünüm altındaki açık "Canlı akış" listesi dashboard'u çok dolu gösteriyor.
İstenen: o bölümü kaldır; sağ üstte **Analiz** butonunun yanına **"Canlı akış"** butonu koy, **mouse ile
üzerine gelince aşağı doğru açılan** bir panelde **son 10 işlemi** göster, en altına **"Tümü"** linki →
tam sayfa (`/activity`). Yapıldı: `LiveFeedMenu` (group-hover, dokunmatikte buton doğrudan /activity linki).

## PF-19 — Duvara asılı tablet için ayrı "Kiosk" rolü · ✅ `done`
2026-07-17 · owner ("hepsini yapalım ama b isterim"). QR ile giriş ekranı tablette gösterilecek; üye
kendi QR'ını okutacak. İstenen: tablet **hiçbir hassas şeye** (üyeler/kasa/ayarlar) ulaşamasın.

**Karar (B — ayrı rol):** Yeni bir `StaffRole = 'kiosk'` — sistemin **en düşük yetkili** principal'ı.
Yalnızca `/checkin/kiosk` alanını ve QR check-in action'ını görür; başka hiçbir ekranı yok, AppShell
(sidebar) çizilmez, isim-arama (üye listesi = PII) verilmez.

**Actor kararı (kritik):** Kiosk bir **cihaz**, insan değil. Kaydettiği check-in event'i `actor.type:
'device'` ile damgalanır — bir insanın kimliğini asla ödünç almaz (12 kural #5). `device` variant
taksonomide ilk commit'ten beri var → **şema değişikliği yok**, yeni event/payload yok, migration yok.
`staff.created` payload'ındaki `role` union'ı `'kiosk'` ile genişler (geriye uyumlu).

**Nasıl kurulur:** Ayarlar → Personel → yeni hesap, rol = *Kiosk (Tablet)* (opsiyon A: özel hesap).
Tablette bu hesapla bir kez giriş yapılır. Reception kendi oturumundan aynı ekranı yedek iPad'de
açmaya devam eder (isim-arama fallback'i onda kalır).

**Yoğun-saat ayarı (opsiyon 3):** Kamera artık sonuç ekranında **sökülmüyor** — "Hoş geldin" bir
overlay olarak biniyor, alttaki stream sıcak kalıyor; sonuç 2.5 sn'de temizleniyor. Arka arkaya
girişlerde getUserMedia yeniden-ısınması yok.

## PF-4 — Üye listesi sayfalama · ✅ `done`
2026-07-16 · owner. Üye ekranı tüm kayıtları tek seferde gösteriyor. İstenen: **10'ar kayıt**, tablo altında
**numaralı sayfalama**, üstte filtre (mevcut arama+çipler kalır), bir de **"Tümünü göster"** butonu. Client-side.

## PF-5 — KK/Havale ödeme farkı (+1000, ayardan) + taksit seçimi · ✅ `done`
2026-07-16 · owner. Kural: **sadece nakitte fark YOK**; diğer tüm ödemelerde (KK, havale, cüzdan-üyelik)
**default 1000 ₺** eklenir — **Ayarlar'dan düzenlenir** (kodda sabit değil). PAYTR ödemesinde tutar =
paket + fark, üyeye kırılım gösterilmez; **taksit seçimi** (max ayardan, default 3). Bu turda PAYTR kart
akışı yapılıyor.

## PF-6 — Fark'ı manuel satışa da uygula (havale/kart, nakit hariç) · ✅ `done` (2fd8c1c)
2026-07-16 · owner (PF-5'in kapsamı). Resepsiyon paketi manuel satarken (Kasa/sell akışı) yöntem nakit
DEĞİLSE aynı ayardaki fark uygulanmalı. PAYTR (kart) config'i inince bu ayrı akışa da bağlanacak. Cüzdan
üyelik ödemesi de dahil (cüzdan top-up hariç); cüzdan henüz seam (DEBT-035).

---

## PF-1 — "Ürün Sat" butonu Ayarlar ekranında olmamalı · ✅ `done` (canlıda)

**Taken:** 2026-07-16 · owner ("bunu notlara ekle, fix geçersin bir ara")
**Where:** Ayarlar → *Ürünler (Retail)* bölümü — sağ üstteki **"Ürün Sat"** butonu.
**Problem:** Ayarlar bir **yapılandırma** ekranı (ürün tanımla/düzenle/kapat). Ürün **satışı** burada olmamalı —
satış operasyonel bir iş, ayar değil. Aynı yerde "+ Ürün ekle" ve "Düzenle" doğru (bunlar yapılandırma),
ama "Ürün Sat" yanlış yerde.
**Proposed fix:** "Ürün Sat"ı Ayarlar'dan kaldır. Ürün satışı için ya (a) dashboard'a bir giriş/kısayol, ya da
(tercih) (b) menüye eklenen **ayrı bir "Ürün Sat" ekranı** — hızlı perakende satış (üye/müşteri seç → ürün →
adet → tahsilat). Ayarlar sadece kataloğu yönetsin.
**Notes:** Satış zaten `retail.ts` action'ında var (transactional stok düşümü, `retail_out_of_stock`); iş
sadece butonu doğru yüzeye taşımak + gerekiyorsa küçük bir satış ekranı. Düşük risk.

---

## PF-2 — Dropdown'lar açılmadan ham value gösteriyordu (svc_… / __none__) · ✅ `done` (43d94f0)

**Taken/Fixed:** 2026-07-16 · owner-reported, hotfix. Base UI `Select.Value` etiketi ancak popup bir kez
açılınca çözüyordu → ilk açılışta `svc_01K…` / `__none__` görünüyordu, app-genelinde. Merkezi fix:
paylaşılan `Select`, `SelectItem` çocuklarından value→label haritası türetip Root'un `items` prop'una
veriyor → tüm dropdown'lar ilk boyamada doğru etiketi gösteriyor. Canlıda.

---

## PF-3 — İptal edilen seans takvimde görünüyor (üstü çizili) · ✅ `done` (033a76f)

**Taken:** 2026-07-16 · owner ("yanlış açtım, iptal ettim ama ajandada üstü çizili gözüküyor; gözükmese
daha iyi mi?").
**Where:** Ders Ajandası (aylık görünüm) — iptal edilen seans üstü çizili + soluk gösteriliyor.
**Recommendation (benim):** **Tamamen gizleme; sadece daha da SOLUKLAŞTIR.** Sebep: (1) üstteki "İPTAL 1"
sayacı ile takvim çelişmesin (görünmezse "1 iptal var ama takvimde yok" daha kafa karıştırıcı olur);
(2) iptalin gerçekten olduğu, dürüst bir kayıt — "iptal ettim mi acaba" şüphesi kalmaz; (3) 15:30'a yeni
seans açınca, soluk-üstüçizili 15:00 açıkça "bu iptal, boşver" diye okunur. Takvim "sadece renk" kuralına
uygun (yalnızca opaklık/renk değişir, düzen değil). **Alternatif:** owner isterse "Tüm Durumlar" filtresi
varsayılan olarak "İptal"i hariç tutsun (istenince gösterilir). Karar owner'ın.

---

## PF-7 — Ayarlar ekranı dağınık, düzenlensin · ✅ `done`

**Taken:** 2026-07-16 · owner ("çok karışık, grupla, kaydet butonu ortada, dağınık").
**Where:** Ayarlar ekranı (Şirket · Çalışma saatleri · Rezervasyon kuralları · QR · Doluluk · Ödeme · Bildirim).
**Problem:** Tüm bölümler tek uzun kolonda akıyor, görsel gruplama zayıf; Kaydet butonunun yeri ortada/dağınık.
**Proposed fix:** Bölümleri **kart/gruplara** ayır (net başlık + kenarlık), iki-kolon düzeni tutarlı olsun,
**Kaydet**'i sabit alt bar (sticky footer) ya da her grubun net bir yerine al. Sadece görsel/düzen — davranış
(alan doğrulama, "boş-gerekli" uyarıları) aynı kalır. Düşük risk, orta iş.

---

## PF-8 — İkon-only butonlarda hover tooltip'i (app-geneli) · ✅ `done` (native, aria-label→title)

**Çözüm:** Paylaşılan `Button` artık `aria-label` verilmiş ama `title` verilmemiş her butonda **aria-label'ı
`title`'a yansıtıyor** → aria-label'lı tüm ikon butonlar (rezervasyon satırı: Geçmiş/Sabit/Taşı/İptal, takvim
okları, vs.) **sıfır call-site değişikliğiyle** native hover tooltip'i kazandı. Erişilebilirlik artısı korunur.
**Kalan (ileride):** (a) aria-label'ı OLMAYAN ikon butonlara aria-label ekle (hem a11y hem tooltip); (b) daha
premium, stillenmiş bir tooltip (native `title` yerine) istenirse ayrı bir polish. Şimdilik native yeterli.

<details><summary>orijinal not</summary>

**Taken:** 2026-07-16 · owner ("bu buton siliyor mu değiştiriyor mu belli değil; mouse üstüne gelince küçük
popup söylesin — genel olarak tüm uygulamada").
**Where:** Her yerde, örnek: seans workspace → Rezervasyon satırı ikonları (Düzenle / Geçmiş / Seansa taşı /
Üye değiştir / İptal) — sadece ikon, etiketi yok, "siler mi değiştirir mi" belirsiz.
**Proposed fix:** Uygulamadaki **ikon-only butonlara** hover/focus **tooltip** ekle (ne yaptığını net Türkçe:
"Düzenle", "İptal et", "Başka seansa taşı" vb.). Yıkıcı olanlar (İptal/Sil) tooltip'te de belli olsun. En
temizi: paylaşılan bir `IconButton`/`Tooltip` deseni — tek yerde tanımla, tüm ikon butonlar `title`/tooltip
alsın. Erişilebilirlik artısı: `aria-label` da gelir. Düşük risk, orta iş (çok call-site).
</details>

---

## PF-9 — KVKK "anonimleştir" üye kartından çıksın, Ayarlar'a taşınsın · ✅ `done`

**Taken:** 2026-07-16 · owner ("her üye kartında kalıcı silme mantıksız + riskli; Ayarlar'da olsun, orada üye
seçip yapılsın").
**Where:** Üye kartı → Genel sekmesi → "KVKK — üye kaydını anonimleştir" paneli (`members/[id]/erasure-panel.tsx`).
**Problem:** Geri alınamaz kalıcı KVKK silme her üyenin detay ekranında duruyor — dağınık ve yanlışlıkla
tetikleme riski. Kişisel "Pasife Al" burada kalabilir (geri alınabilir); ama kalıcı silme burada olmamalı.
**Proposed fix:** Erasure panelini üye kartından **kaldır**, **Ayarlar** altında ayrı bir "KVKK / Gizlilik"
bölümüne taşı — orada üye ara/seç → anonimleştir. Yetki yine `platform_admin` (AD-67) kalır; bu sadece
YERİNİ değiştirir, davranışı/güvenliği değil. Orta iş (yeni küçük ekran + member picker), düşük risk.

---

## PF-10 — Üye kartı + üye portalı üst tabları sıkışık · ✅ `done`

**Taken:** 2026-07-16 · owner ("Kısıtlı Üyelik/Cari Hesap sığmamış iki satıra kırılıyor, hoş durmuyor; üye
portalında da Rezervasyon yap / Rezervasyonlarım / Antrenman tabları çok sıkışık").
**Where:** (1) Üye kartı üst sekmeleri (Genel · Paketler · Rezervasyonlar · Kısıtlı Üyelik · Antrenman ·
Check-in · Cari Hesap · Geçmiş) — dar ekranda kırılıyor. (2) Üye portalı üst navigasyonu — aynı sıkışıklık.
**Proposed fix:** Tab şeridini **responsive** yap — yatay **kaydırılabilir** (overflow-x, tek satır, kırılma
yok) ve/veya dar ekranda ikon + kısa etiket; ya da mantıklı gruplama (ör. az kullanılanları bir "Daha fazla"
altına). İki-satıra-kırılma olmasın, tek satır düzgün dursun. Sadece görsel/düzen; sekme içerikleri aynı.
Orta iş (paylaşılan Tabs deseni + portal nav), düşük risk.

---

## PF-11 — Egzersiz kütüphanesi: form görselleri + hareket rehberi (kas grupları, ipuçları, sık hatalar) · ✅ `done`

**Taken:** 2026-07-16 · owner ("videoyu ekledik güzel; bir de hareketin doğru açısını, başlangıç ve yapılış
esnasındaki görselini göster; açıklama, ipuçları ve sık yapılan hataları da araştırıp buraya yaz. Örnek
infografik: HORIZONTAL LEG CURL").
**Where:** Antrenman ekranı → egzersiz detayı (videoyu eklediğimiz yer). Hem staff antrenman ekranı hem üye
portalı "Antrenman" sekmesi için değerli.
**What (referans infografikteki bölümler):**
- **Görseller:** hareketin **başlangıç** + **yapılış (bitiş)** pozisyonu, doğru açıyı gösteren; ayrıca
  **DOĞRU hareket ✓ / YANLIŞ hareket ✗** karşılaştırması (referanstaki gibi).
- **Hedef kas grupları:** Ana hedef / İkincil hedef / Zayıf etki (ör. Leg Curl → Hamstring / Gluteus / Calf).
- **Hareketin özeti:** kısa, sade anlatım.
- **Uyarılar:** güvenlik notları ("belini yaslama", "kontrollü ve yavaş", "momentum yapma" vb.).
- **İpuçları + sık yapılan hatalar:** her egzersiz için **araştırılıp** yazılacak metin.
**Proposed approach:**
- **Veri modeli:** egzersiz kataloğunu (`tools/setup/exercises.ts` / catalog) bir `guidance` nesnesiyle genişlet:
  `{ primaryMuscles, secondaryMuscles, minorMuscles, summary, warnings[], correctCues[], commonMistakes[],
  images: { start, execution, correct, wrong } }`. Metin içerik = data (kodda literal değil), video deseniyle aynı.
- **İçerik:** her egzersiz için kas grupları/özet/uyarı/ipucu/sık-hata metnini araştırıp doldur (fitness
  egzersizleri; owner'ın 21 hareketi + önerilenler). Bu işin ağır kısmı **içerik üretimi**, kod değil.
- **⚠️ Görsel telifi (kritik):** referans infografik gibi hazır görselleri **kopyalayamayız** (telif). Seçenekler:
  (a) kendi çizimlerimizi/illüstrasyonlarımızı üret/ısmarla, (b) açık-lisanslı bir egzersiz görsel kaynağı,
  (c) sade anatomik diyagram + ok/annotasyon. Karar owner'ın; görselsiz başlayıp önce metin+kas-grubu rehberi
  yayınlanabilir (görseller sonra eklenir — model buna hazır olsun).
- **Depolama:** görseller Firebase Storage'da; metin catalog/data'da. Üye portalında da salt-okunur gösterilir.
**Effort:** Orta-yüksek (veri modeli + içerik + görsel tedariki). Faz: kod seam'i küçük, asıl maliyet içerik/görsel.
Videolarla aynı "egzersiz zenginleştirme" başlığı altında ilerler.

---

## PF-12 — Tema / Görünüm ayarları: dinamik renk paleti + font + font-size (Ayarlar › Tema) · ✅ `done`

**Taken:** 2026-07-16 · owner ("uygulama genelindeki renk paletlerini, fontu ve font-size'ı Ayarlar › Tema
altında yeni bir ekrandan dinamik değiştireyim; açık/kapalı tema renklerini de buradan seçelim; hazır tema
şablonları ya da tek tek sidebar/ajanda bg/ders hücresi bg — hangisi kolaysa. Büyük iş, farkındayım").
**Where:** Yeni ekran: **Ayarlar › Tema**. Etki: app-geneli (sidebar, yüzeyler, ajanda, tipografi).
**What:** Stüdyoya özel görünüm yapılandırması — (1) **renk paleti** (accent + nötrler, **açık VE kapalı** tema),
(2) **font ailesi**, (3) **font-size ölçeği** (S/M/L). Bugün açık/kapalı tema renkleri design token'larda (kod,
Doc 09 semantic tokens); bu ekran o katmanı düzenlenebilir/şablon yüzeyine taşır.
**Mimari öneri (ÖNEMLİ — presets-first):**
- **Önce hazır şablonlar (curated presets).** Her şablon = tam ayarlanmış, erişilebilir kontrastlı, premium bir
  **açık+kapalı** token seti. Owner birini seçer → app-geneli CSS custom property olarak enjekte edilir.
  **Bu hem DAHA KOLAY hem DAHA GÜVENLİ:** serbest renk/font seçici premium design language'i ve WCAG kontrastı
  kolayca bozar (mimari itiraz: [[premium-design-language]]). Şablonlar bu çıtayı korur.
- **Faz 2 (opsiyonel):** bir şablonun üstüne **granular override** (accent seçici; tek tek sidebar / ajanda bg /
  ders hücresi bg). Guardrail'lerle (kontrast kontrolü). Owner isterse.
- **Veri modeli:** `studios/{sid}/settings/theme` = `{ preset, overrides?, fontFamily, fontScale }`. Config,
  event-sourced DEĞİL (paymentProvider/notification-template gibi). Server okur, `:root` token'larını + `data-theme`
  enjekte eder. **Fontlar self-hosted** (CDN yok). Font-size = `--font-scale` çarpanı / root font-size.
**Effort:** YÜKSEK (token enjeksiyon seam'i + UI + kalıcılık + fontlar). Presets-first ile tractable kalır.
**Risk:** Serbest seçici → kontrast/premium bozulur; presets + guardrail ile düşük. [[calendar-views-only-recolor]]
ile uyumlu (düzen değişmez, yalnız renk/tema).

---

## PF-13 — Takvim seans hücrelerini renklendir (ders tipi / durum bazlı background) · ✅ `done`

**Taken:** 2026-07-16 · owner (eski "bulut gym" ekran görüntüsü örnek: seans hücresinin background'u ders tipine
göre renkli — siyah/kırmızı dolu hücreler).
**Where:** Rezervasyon ajandası (ay / hafta / gün) — seans hücreleri.
**What:** Seans hücresinin **background'unu ders kategorisine** (Reformer / Fitness / Crossfit …) ve/veya
**duruma** (dolu / iptal) göre renklendir. Referanstaki gibi belirgin, taranabilir renk kodu.
**Approach:** kategori → renk token eşlemesi (data-driven; catalog `category` enum'undan). Hücre bg o token'dan.
**DÜZEN AYNI KALIR — yalnızca renk** ([[calendar-views-only-recolor]] kesin kuralı). PF-12 ile bağlanır:
kategori renkleri tema config'inden gelebilir (şablonlar tanımlar), ya da önce sabit bir palette ile başlanır.
**Effort:** Orta, **yüksek görsel etki**, düşük risk. PF-12'nin küçük, hızlı kardeşi — tek başına da yapılabilir.

---

## PF-14 — Ürün Sat dialogunda kasa seçici yok → nakit/POS satış hep başarısız (BUG) · ✅ `done`

**Taken:** 2026-07-16 · owner ("ürün satışı yapamadım; 'Nakit ve POS tahsilatı için bir kasa seçilmelidir' hatası").
**Where:** `components/retail-sale-dialog.tsx` (menü → Ürün Sat).
**Problem:** Dialog yalnızca yöntem (Nakit/Havale/Kart) seçtiriyor, **kasa (drawer) seçici içermiyor** ve satışa
`drawerId` göndermiyor. Nakit/POS için açık kasa zorunlu (`drawer_required`) → satış hep reddediliyor. Üye
cari-hesap akışı (`account-panel.tsx`) açık kasayı otomatik seçip gönderiyor; ürün satış dialogu bunu yapmıyor.
**Fix:** Dialog açık kasaları (`listDrawersAction`) yüklesin; nakit/POS'ta **tek açık cash kasayı otomatik seç**,
birden fazlaysa seçici göster; **açık kasa yoksa** net mesaj + Kasa'ya kısayol ("Açık kasa yok — Kasa ekranından
açın"); havale gibi kasa gerektirmeyen yöntemde seçici gizli. Düşük risk, satış blokerı. **Not:** kasa Ayarlar'da
oluşturulur (kapalı doğar), **Kasa ekranından (/finance) Açılış** ile açılır — bu akış zaten var, keşfi zayıf.

---

## PF-15 — Kasa düzenleme (yeniden adlandır / sil) yok · ✅ `done`

**Taken:** 2026-07-16 · owner ("merkez kasayı düzenleme vs yok, anlamadım").
**Where:** Ayarlar › Tanımlar › Kasalar (`definitions-panel.tsx`).
**Problem:** Kasada sadece **oluştur** + (Kasa ekranında) aç/kapat var; **yeniden adlandırma / silme / pasife alma**
yok. Yanlış isimli/mükerrer kasa düzeltilemiyor.
**Fix:** Kasa satırına düzenle (ad) + pasife al/sil (hareketi yoksa sil, varsa pasife al) ekle.
**⚠️ MİMARİ (ertelendi):** Drawer **event-sourced** (`decideCreateDrawer` event yayınlıyor). Rename/arşiv →
**yeni event tipi** (`drawer.renamed` / `drawer.archived`) gerekir. Event şeması değişikliği = **insan kararı**
(non-negotiable, "slow down"). Bu yüzden otonom batch'te YAPILMADI — owner event kararını verince eklenir.
Geçici workaround: doğru isimle yeni kasa oluştur.

---

## PF-16 — Toast mesajları sağ-alttan → daha görünür konum · ✅ `done`

**Taken:** 2026-07-16 · owner ("toast'lar sağ alttan çıkıyor, ekranın ortasına mı gelse").
**Where:** Global `Toaster` (sonner) — `position`.
**Öneri:** Tam orta içeriği bloklar (önerilmez); **top-center** iyi orta yol — önemli hataları (kasa gibi) kaçırmaz,
çalışma alanını kapatmaz. Tek satırlık değişiklik. Düşük risk.

---

## PF-17 — Toplu Gönderim'de mail başarısız ("0 gönderildi, 1 başarısız") · ✅ `done`

**Taken:** 2026-07-16 · owner ("mail göndermek istedim, başarısız oldu").
**Where:** Bildirim Merkezi › Toplu Gönderim (şablon "Açık bakiye hatırlatması").
**Problem (araştırılacak):** Gönderim başarısız — muhtemel nedenler: (a) üyenin **e-postası yok** (listede telefon
var, e-posta yok), (b) **kanal/transport yapılandırılmamış** (WhatsApp Meta / e-posta), (c) üye **kanal tercihi/
rızası** uygun değil. Hotfix sırasında: gerçek `attempt.status`/hata koduna bak; kullanıcıya **net sebep** göster
("e-posta yok" / "kanal kapalı" / "rıza yok"), sessiz "1 başarısız" yerine. Fix kapsamı sebebe göre netleşecek.
**Ek gözlem (owner, 2 görsel):** (1) Toplu gönderimdeki **başarısız kayıt "Bildirimler" listesine düşmüyor** —
başarısız denemeler de loglanmalı/görünmeli. (2) Bildirimler'de e-postalar **"Gönderildi"** görünüyor ama owner
**gerçekten teslim edildi mi** şüpheli ("sanki burası çalışmıyor gibi"). Teşhis: Resend gerçekten yolluyor mu
(prod log + Resend), "Gönderildi" statüsü sağlayıcı onayını mı yoksa sadece "denendi"yi mi gösteriyor — netleştir.

---

## PF-24 — İşletme Sağlık Panosu (sistem/entegrasyon sağlığı) · 📋 önerildi (ayrı milestone)

**Taken:** 2026-07-18 · owner ("patron sabah bilgisayarı açtığında işletmede neyin dikkat gerektirdiğini 30 saniyede
görecek").
**Ne:** Owner dashboard'a bir **sistem sağlığı** şeridi — iş/karar-destek (churn, yenileme, bakiye = advisor/Öneriler)
değil, **altyapı gözlemlenebilirliği**. İçerik:
- **Çalışmayan entegrasyonlar** — WhatsApp/e-posta/PAYTR provider yapılandırılmış mı (settings + `provider_not_configured`).
- **Başarısız bildirimler** — son N günde `notification` status=failed/error olanların sayısı + link (Bildirim Merkezi).
- **PAYTR durumu** — provider config var mı, test_mode?, son callback başarı/hata (payment_intent sonuçları).
- **Storage durumu** — bucket yapılandırılmış + erişilebilir mi (env + hafif probe).
- **Functions sağlığı** — trigger/scheduled job'lar çalışıyor mu; `projectionLagsBehind` zaten var (tohum), scheduled
  job son-çalışma zamanı (expire-credits / auto-resolve) eklenir.
- **Kritik alarmlar** — yukarıdakilerin "kırmızı" olanlarını tek yere toplayan özet.
**Neden ayrı milestone:** domain farklı (infra/ops probe'ları vs üye/iş sorguları). Churn milestone'una karıştırmak
kapsam disiplinini bozar (owner da "uygunsa dahil et değilse not et" dedi → değil, not edildi).
**Mimari notu:** çoğu "şu an" durumu → **bounded state query/probe**, projeksiyon DEĞİL (daily.ts §16-20 kuralı).
Bazıları yeni denorm/sinyal gerektirebilir (scheduled job heartbeat). "Normal sessiz, anormal gürültülü" deseni
(dashboard-screen) burada da uygulanır.
**Sıra:** churn sinyali (PF-23) bitince önerilecek bir sonraki milestone.

---

## PF-25 — Üye workspace sekmeleri sığmıyor (yatay taşma) · 🔧 hotfix

**Taken:** 2026-07-18 · owner (görsel: sekmeler sağda kesiliyor).
**Where:** `member-workspace-screen.tsx` — `TabsList` (9 sekme: Genel · Paketler · Rezervasyonlar · Kısıtlı
Üyelik · Antrenman · Check-in · Cari Hesap · **Belgeler** · Geçmiş). "Belgeler" (v1.28) 9'a çıkardı.
**Problem:** Şerit `overflow-x-auto whitespace-nowrap` ile YATAY KAYIYOR (PF-10 kararı: tek sıra, wrap yok),
ama masaüstünde son sekme yarım kesik görünüyor — kaydırılabilir olduğu belli değil, "bozuk" gibi duruyor.
Mobilde ikon-only (label `hidden sm:inline`) — orada da doğrula.
**Hotfix önerisi:** kaydırma ipucu ekle — sağ kenara **fade/gradient maske** (kaydırılabilir olduğu görünür),
veya sekme padding/font'unu biraz sıkıştır ki daha çok sığsın. Wrap'e DÖNME (PF-10). 375/430/768/1280'de test.

---

## PF-26 — "Açık bakiye 4210 TL doğru mu?" (test üyesi) · ✅ incelendi · HATA YOK

**Taken:** 2026-07-18 · owner ("en son 10 TL aldık başarılı, neden açık bakiyeye yansımış").
**İnceleme (mem_01KXKT5432M8Z54AQKZWB4FW5V "ışıl deneme" satışları, prod Firestore):**
8 satış — settled: 20 + 9000×4 + 10 (başarılı PAYTR); **open: 4200 + 10**. Açık bakiye = 4200 + 10 = **4210 ✓**.
**Sonuç:** Bakiye ARİTMETİĞİ DOĞRU. Başarılı 10 TL PAYTR **settled** (ödendi) ve açık bakiyeye YANSIMIYOR —
owner'ın endişesi yersiz; açık bakiye 2 GERÇEKTEN ödenmemiş satıştan geliyor (4200'lük eski test satışı +
21:56'daki ödenmemiş 10'luk test paketi). Payment ⟂ Entitlement (Doc 2): ödemesiz satış meşru, balanceDue>0.
Kod hatası yok. **Aksiyon:** sadece test verisi temizliği — owner o iki açık satışı "İptal" ile kapatabilir
(ya da ödeyebilir). Not: PAYTR sale'i yalnızca başarılı callback'te oluşuyor (abandoned link phantom borç
YARATMIYOR — doğrulandı).

---

## PF-27 — Kiosk için USB QR okuyucu donanımı (opsiyonel akıcılık) · 💡 fikir/karar

**Taken:** 2026-07-18 · owner ("kiosk tablet yerine QR reader donanımı alsam?").
**Danışma sonucu:** Donanım tableti YERİNE koymaz, TAMAMLAR — ucuz okuyucular keyboard-wedge (okuduğu metni
yazar), yani yine host (tablet/mini-PC) + kiosk ekranı gerekir; okuyucu kameranın yerine geçer. **Öneri:
tablet + USB 2D IMAGER okuyucu** (lazer/1D DEĞİL — telefon ekranından okuyamaz). Bağımsız ağ terminali =
overkill (kapı/turnike istemiyorsak). Dinamik üye QR'ı (D16) okuyucu için sorun değil.
**Asıl mesele:** şu an HİÇ check-in yapılmıyor → sorun donanım değil, alışkanlık. Önce tableti iyi konumlandırıp
bedava dene; kalabalık saatlerde akıcılık kritikse imager al.
**Yazılım işi (owner okuyucu alırsa):** kiosk ekranına (`checkin/kiosk/kiosk-screen.tsx`) okuyucudan gelen
"yazılan token + Enter" girişini dinleyip aynı `checkInByQrAction`'ı çağıran bir yol ekle (şu an sadece
getUserMedia kamera var). Küçük milestone. Karar owner'da.

---
## Kullanım geri bildirimi batch (2026-07-18, owner) — PF-28…PF-36 (sıra onaylı)

**PF-28 — Site üye girişi linki çalışmıyor · 🔧 hotfix.** `~/pilates-site` "Üye Girişi" butonu portal'a `?s=retro`
olmadan gidiyor → stüdyo belirsiz, giriş olmuyor. Doğru URL: `https://panel.pilatesfitnessbyisil.com/portal/login?s=retro`.
Site ayrı deploy (Firebase Hosting `pilatesfitnessbyisil-web`).

**PF-29 — Girişlerde captcha · özellik.** KARAR: **2a = basit captcha** (matematik/"robot değilim") + giriş
**rate-limit**. Dış servis YOK (reCAPTCHA/CSP değil). Üye portal + staff login.

**PF-30 — Admin ↔ üye girişi oturum çakışması · düşük öncelik fix.** Aynı tarayıcıda staff oturumu varken
`/portal/login`'e gidince admin'e yönleniyor. Gerçek üyeyi etkilemez (sadece staff test ederken). Geçici:
gizli sekme. Kalıcı: portal girişi staff oturumunu görmezden gelsin. Owner: düşük öncelik onayladı.

**PF-31 — Canlı akış = iş olayları, sistem logları değil · özellik.** Akışta yalnız: rezervasyonlar, check-in'ler,
ödeme/PAYTR sonuçları (PF-8 birleşik), üye bildirimleri. Teknik olaylar (exercise.upserted, notification.queued
vb.) ÇIKSIN. Sistem sağlığı ayrı (PF-24).

**PF-32 — Antrenman geri bildirimi → anlık bildirim + detay · özellik.** Bildirim hangi üye + **hangi egzersiz/
hareket + hangi program** desin (şu an sadece üye). trainingFeedback + notifications.

**PF-33 — Üyeler listesi default "son eklenen" + sıralama butonu · 🔧 hotfix.** Şu an isim (A-Z) sıralı
(member-repo `orderBy('fullName')`). Default son-eklenen; toggle: A-Z / Son eklenen.

**PF-34 — Program aktif/pasif lifecycle (7a) · özellik.** Üye kartında aktif program vs pasif programlar;
aktif↔pasif geçiş, düzenleme. AI'sız. PF-35'in altyapısı.

**PF-35 — AI ile program oluşturma (7b) · 🤖 BÜYÜK AI MILESTONE.** Program oluştur → "AI ile mi?" → evet →
"ne ağırlıklı? (sırt/karın/göğüs/kalça/zayıflama)" → eski programı da dikkate alıp **bizim 45'lik egzersiz
havuzundan** (kas-etiketli) yeni program → **hoca gör/düzenle/kabul (ONAY ZORUNLU — egzersiz reçetesi,
sakatlık riski)** → aktif yap + eskiler pasif + üyeye bildirim. AI SADECE havuzdan seçer (serbest uydurmaz).
7a'dan SONRA. İlk AI özelliği — Faz 2 Dalga 3 ruhu.

**PF-36 — QR check-in → resepsiyon toast (yeşil/kırmızı) · özellik.** Üye giriş yapınca resepsiyon ekranında
toast: üye adı + paket + başlangıç/bitiş + aktif bildirim var/yok + kredi kaç kaldı. **Aktif üyelik → YEŞİL bariz,
yoksa KIRMIZI.** Check-in olayını resepsiyon ekranına anlık düşürmek gerek.

**QR yönü kararı (PF-27 ek):** owner scanner (Q22) ile çözecek → **mevcut yön korunur, ters çevrilmez.**

**SIRA (owner onaylı):** PF-28/33/31 (hızlı) → PF-36 + PF-32 → PF-34 → PF-29 → PF-35 (AI) → PF-30 (düşük).

---

## PF-37 — Instagram/herkese açık "paketi doğrudan satın al" linki (taksitli) · 💡 fikir/feature

**Taken:** 2026-07-18 · owner ("Instagram'a 'Fitness 3 aylık 9bin TL 3 taksit', '6 aylık 14bin 3 taksit' diye
link koyabilir miyim?").
**Taksit (ön koşul):** PAYTR taksit DESTEKLİYOR, bizde `maxInstallments: 3` ayarı zaten var → ödeme ekranında
taksit çıkar. AMA owner'ın **PAYTR/banka anlaşmasında taksit AKTİF olmalı** (+ taksit banka komisyonu stüdyoya
biner). Owner PAYTR'a "hesabımda taksit açık mı, 3'e kadar" diye sormalı.
**Özellik:** Şu an ödeme linkleri resepsiyonun bir ÜYEYE kestiği satışa bağlı. Instagram için **herkese açık,
üye gerektirmeyen** link lazım: public sayfa (paket + fiyat + "Taksitle Öde") → alıcı ad+telefon girer → PAYTR
taksitli link → öder → **callback telefondan üyeyi bulur ya da YENİ üye oluşturur + paketi tanımlar + ödemeyi
kaydeder** (mevcut PAYTR grant mantığı + member create/phone-uniqueness). Instagram → self-servis satın alma →
yeni üye (funnel/büyüme). Mimari: public route (login yok), rate-limit/captcha (PF-29 hook'u), callback'te
member upsert. Orta boy feature.

**PF-37 GENİŞLETİLDİ (2026-07-18, owner):** Sadece sabit paket linki değil — **Ayarlar'dan genel link üreteci**:
istenen fiyat + istenen taksit sayısı (+ etiket) seçilir → link üretilir → "paylaş/kopyala" (Instagram/WhatsApp).
Link herkese açık ödeme sayfasına gider. **AÇIK TASARIM KARARI (owner'a soruldu):** ödeme yapınca (a) BELİRLİ
bir PAKET mi tanımlanır (ör. Fitness 3 Aylık → üye + paket), yoksa (b) serbest tutar mı tahsil edilir (paket yok,
sadece ödeme/bakiye)? Öneri: **(a) ürün-bağlı** — link bir ürün + fiyat override + taksit taşır; ödeyince
telefon/ad'dan üye bulunur/oluşturulur + o paket tanımlanır (mevcut PAYTR grant + member upsert). Feature olarak
geliştirilecek; deploy ayrı. PAYTR taksit hesapta aktif olmalı (owner PAYTR'a soracak).
