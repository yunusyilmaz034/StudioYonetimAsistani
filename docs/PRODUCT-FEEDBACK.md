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
