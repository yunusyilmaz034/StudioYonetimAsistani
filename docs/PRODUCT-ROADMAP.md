# Ürün Yol Haritası — tek stüdyodan satılabilir ürüne

**Durum:** owner onaylı · **2026-08-04'te ticari taraf karara bağlandı.** Teknik yön 2026-07-26'dan
beri duruyordu; fiyat, destek modeli, alan adı ve konumlandırma bu tarihte netleşti.

**Hedef:** aynı sistemi ikinci, üçüncü, beşinci stüdyoya **kurulum + yıllık lisans** ile satabilmek.

---

## 1. Rakip ve konumlanma

Owner sekiz yıl BulutGym kullandı ve oradan çıktı. Söyledikleri, bu bölümün tamamının kaynağı:

> *"BulutGym'de sistemde ve destekte hiçbir yavaşlık yoktur, SLA'nın ne kadar önemli olduğunu
> onlardan öğrendim ve gerçekten iyi yönetiyorlar."*

**Rakibin hendeği teknoloji değil, işletme.** Bunu doğru okumak stratejinin tamamını belirliyor:

| | BulutGym | Biz |
|---|---|---|
| Teknoloji | Eski | **Üstün** |
| Hız ve destek | **Yıllarla kanıtlanmış** | Henüz kanıtlanmamış |

Bizim üstünlüğümüz zamanla kopyalanabilir; onlarınki yıllarla kazanılıyor. Yıllardır iyi hizmet almış
bir stüdyo sahibinin sorduğu soru *"AI var mı"* değil, **"beni yarı yolda bırakır mı"**. Teknoloji
masaya oturtur, güven satışı kapatır.

**Pratik sonuç: operasyonel hazırlık satışın önkoşuludur, konforu değil.** Dış izleme, bakım
penceresi ve yedekten dönüş provası "sonra yaparız" listesinde olamaz (bkz. §6).

### Rakipte olmayanlar (owner'ın kendi listesi)

WhatsApp yok · AI yok · bildirim yok · fitness'a özgü antrenman/egzersiz bölümü yok · üyelik bazlı
ajanda görünümü yok · tatil günü ve takvim yönetimi yok · **admin paneli responsive değil**.

Sonuncusu soyut bir üstünlük değil, günlük bir acı: stüdyo sahibi işini telefondan takip ediyor.
Bizim panelimiz mobil-öncelikli ve 375 · 430 · 768 · 1280 px'de doğrulanıyor (Doc 09 §9).

### Konumlandırma cümlesi

> **Aynı hız, aynı destek. Ama telefonundan yönetebildiğin, üyenle WhatsApp'ta senin yerine konuşan
> ve fitness tarafını da gerçekten bilen bir sistem.**

İlk cümle rakibi inkâr etmez — standardını kabul eder, sonra üstüne koyar. "Bizde AI var" ile
başlayan bir satış konuşması, mevcut sisteminden memnun birine bir şey anlatmaz.

---

## 2. Karar: TEK kod tabanı. Müşteri başına ayrı sistem YOK.

Ayrı sistem kurmak yapılmış işi çöpe atmaktır: her hata iki yerde düzeltilir, her özellik iki kez
yazılır, beşinci müşteride bakım imkânsızlaşır. **Yeni müşteri = yeni bir `studioId`.**

Bu, mimarinin ilk cümlesi ve bir yıldır tutuldu. Ölçüldü (2026-07-26): kodda sabitlenmiş stüdyo izi
**4 eşleşme**, ikisi yorum. Ödeme sağlayıcı, tema, katalog, politikalar, AI kartı, şablonlar, yetki
matrisi, veri izolasyonu — hepsi stüdyo başına.

**Eksik olan üç şey** (Faz A): WhatsApp numarası, e-posta göndericisi, tek komutla kurulum.

---

## 3. Fiyatlandırma

**Çıpa:** BulutGym yıllık **11.000 TL**, ve white-label üye uygulaması dahil. Yani uygulama fark
yaratan özellik değil, **masaya oturmak için asgari şart**.

### Prim yolu seçildi

11.000 TL/yıl bir *hacim* fiyatıdır ve hacim işi, elle kurulum ve müşteriye özel mobil uygulama ile
birlikte yürümez — ikisi de müşteri başına gün harcatır. On müşteri × 11.000 TL bir iş değildir; elli
müşteri ise bir destek organizasyonudur.

| | Prim (**seçilen**) | Hacim (reddedilen) |
|---|---|---|
| Fiyat | Rakibin 2-3 katı | Eşit / altı |
| Satış argümanı | AI + operasyonel derinlik + destek | Ucuzluk |
| Müşteri | Az ve seçilmiş | Çok |
| Kurulum | Elle, özenli, **ücretli** | Neredeyse dokunmasız olmalı |

### Kalemler (owner onayı, 2026-08-04)

| Kalem | Aralık | Not |
|---|---|---|
| **Yıllık lisans** (white-label mobil uygulama dahil) | **22.000 – 30.000 TL** | Aktif üye bandına göre üç kademe: ≤150 · 150–400 · 400+ |
| **AI paketi** (WhatsApp resepsiyonist + patron asistanı) | **7.000 – 10.000 TL/yıl** | **AYRI ve TAVANLI** — aylık N konuşma dahil, aşımı birim fiyat |
| **Kurulum** (bir kerelik) | **8.000 – 12.000 TL** | 2-3 gün gerçek emek + Meta/PAYTR süreçleri |
| **Veri aktarımı** (bir kerelik) | **3.000 – 8.000 TL** | Üye sayısına göre kademeli |
| **Kendi alan adı** | Ek ücret | Standart: ortak alt alan adı |
| **Home Assistant** | Ayrı — bkz. §7 | Donanım + montaj; asla lisansa dahil değil |

**Lisans bandı neden aktif üye sayısı:** hem maliyetle (okuma/yazma, mesaj, AI) hem müşterinin
cirosuyla orantılı, **ve sistemde zaten ölçülüyor** — "aktif üye" = gerçekten paketi olan üye
(OR-23, 2026-08-01). Faturalamanın dayanağı hazır ve tartışmasız.

### AI neden lisansa gömülemez

Işıl'ın stüdyosunda ölçüldü: **~6 $/ay** (önbelleklemeden sonra). Yoğun bir stüdyo bunun 3-5 katını
harcar. Rakibin tüm yıllık fiyatı ~900 TL/ay iken, tek bir kalemin bunun ciddi bir dilimini yemesi
demek. Sabit lisansa dahil edilirse **riski platform taşır ve yoğun müşteri zarar ettirir.**

### Türkiye'ye özel: TL'de sabit yıllık fiyat erir

Sözleşmeye **yıllık güncelleme maddesi** konmalı. Baştan yazılmazsa ikinci yıl zam konuşmak zor olur.

### İlk müşteri tam fiyattan satılmaz

**Novozen = tasarım ortağı:** %40-50 indirim, karşılığında toleranslı olması, geri bildirim vermesi
ve referans olması. İkinci müşteri her zaman en pahalıdır — ürünün tek müşteriye özel varsayımlarını
o bulur ve bulduklarını ücretsiz düzelteceğiz.

---

## 4. Destek modeli ve SLA

Rakibin en güçlü tarafı bu; taahhüt edilen tutulamazsa hiç taahhüt etmemekten kötüdür.

| Sınıf | Örnek | Taahhüt |
|---|---|---|
| **Kritik** | Panel açılmıyor, ödeme alınamıyor, check-in çalışmıyor | Çalışma saatlerinde **2 saat** içinde cevap, **aynı gün** müdahale |
| **Yüksek** | Bir ekran bozuk, işin başka yolu var | **1 iş günü** içinde cevap |
| **Normal** | Yanlış görünen bir şey, soru | **2 iş günü** |
| **İstek** | "Şu da olsa" | Sıraya alınır, tarih taahhüdü yok |

**Destek saatleri: Pzt–Cmt 09:00–20:00.** Stüdyolar akşam ve cumartesi çalışıyor; hafta içi mesai
saati desteği gerçek hayata uymaz.

**Bakım penceresi: 23:00–07:00.** Güncellemeler burada yapılır. Bu aynı zamanda OR-17'yi
(*"her deploy açık sekmeleri kırar"*) ürün seviyesinde çözer: sözleşmede yazılıdır, resepsiyon sabah
bir kez yeniler.

**Çalışma süresi (uptime) için sayı VERİLMEZ** — dış izleme kurulana kadar. Ölçmediğin bir şeyi
taahhüt etmek, rakibin en güçlü olduğu alanda tutamayacağın söz vermektir. Onun yerine ne yapıldığı
yazılır: gecelik altyapı kontrolü, yedekleme, izleme. Dış izleme kurulduktan sonra sayı eklenir.

---

## 5. Destek merkezi — "Bildir" doğru fikir, yanlış adres

Bugün `Bildir` `/studios/{sid}/feedback`'e yazıyor ve **o stüdyonun sahibi** okuyor. Owner aynı
zamanda platform olduğu için ikisi tek şey gibi görünüyor. Ürün olunca ikiye ayrılır:

| | Kim okur | Örnek |
|---|---|---|
| Stüdyo içi not | O stüdyonun sahibi | "fiş yazıcısı yanlış kesiyor" |
| **Platform bileti** | **Biz** | "panel açılmıyor", "bu bir hata" |

Bizimki rakibin destek formundan **daha iyi olabilir**, çünkü bağlam zaten elimizde: kim, hangi rol,
hangi stüdyo, hangi ekran, hangi sürüm. Kullanıcıya yazdırmıyoruz.

**Tasarım:**
- Bildir'e basınca **kime gittiği sorulur** — "Stüdyo sahibine" / "Sisteme".
- Platform biletleri **platform seviyesinde tek koleksiyona** yazılır (`studioId` bir alan olarak).
  Stüdyoların altını tarayan sorgu (`collectionGroup`) mimaride yasak ve haklı olarak yasak — çapraz
  stüdyo okuma yolu tam olarak öyle doğar.
- **`platform_admin` ekranı stüdyo bağlamı olmadan çalışmalı.** Bugün her personel ekranı tek bir
  stüdyonun `TenantContext`'ini çözerek açılıyor; platform ekranının bir stüdyosu yok. Rol bayrağı
  (`claims.platformAdmin`) var, kapısı ve ekranı yok. **Bu, Faz B'nin gerçek işi.**

**KVKK uyarısı:** bilet metni serbest yazı ve resepsiyon oraya üye adı yazacaktır. Platform olarak
başka stüdyonun üye verisini okumuş oluruz. Ya giriş alanında uyarı ("üye adı yazmayın"), ya
sözleşmede **veri işleyen** sıfatıyla düzenlenmeli. Şimdi karara bağlamak sonra düzeltmekten ucuz.

---

## 6. İkinci ÖDEYEN müşteriden önce — pazarlık dışı

Rakibin güçlü olduğu alan operasyon; oraya hazırlıksız girilmez.

1. **Faz A** — A1 WhatsApp numarası · A2 e-posta göndericisi · A3 `pnpm studio:new` (aşağıda)
2. **Dış uptime izleme** — bugün YOK, ve yokluğu sessiz: watchdog kendi susuşunu haber veremez.
   Proje askıya alınırsa bütün alarmlar susar ve bu, her şey yolundaymış gibi görünür.
3. **Bakım penceresi** — deploy'un açık sekmeleri kırması tek stüdyoda haber vererek çözülüyor; beş
   stüdyoda beş resepsiyona haber verilemez.
4. **Hibrit satış + Sanal POS canlı testi** — ikisi de bugüne kadar gerçek bir işlemle hiç çalışmadı.
   Kendi stüdyonda patlarsa öğrenirsin; müşteride patlarsa itibar.
5. **Yedekten dönüş provası** — yedek almak yeterli değil, geri dönebildiğini bir kez denemek gerekir.
6. **Sözleşme + SLA metni** — ne söz veriliyor, neyi kapsamıyor.

**Faz A tamamlanmadan ikinci müşteri kurulmamalı.** Kurulursa mesajları ilk stüdyonun numarasından
gider ve geri dönüşü olmayan bir karışıklık doğar.

### Faz A

**A1 · WhatsApp numarası stüdyo başına.** Bugün numara ve token ortam değişkeninde.
→ `settings/whatsapp` (phoneNumberId + token referansı); token Secret Manager'da stüdyo başına ayrı.
Webhook zaten `/{studioId}` yolunu okuyor. **Dikkat:** şablonlar Meta'da hesap başına onaylanıyor,
her yeni stüdyo kendi onay sürecini yaşar (1-3 gün) — kurulum takvimine yazılmalı.

**Karar (owner, 2026-08-09): her stüdyonun KENDİ WABA'sı.** Alternatifi — tüm müşterilerin
numaralarını bizim tek Business hesabımıza almak — daha az iş çıkarırdı ve reddedildi.

Bu karar, kod okunurken çıkan bir sorunu kendiliğinden çözüyor: **onaylı Meta şablonlarının sabit
metninde stüdyonun adı geçiyor** (`uyelik_daveti`: *"…Pilates Fitness by Işıl'da üyeliğin artık
dijital…"*). Ortak hesapta bu, ikinci stüdyonun üyesine birinci stüdyonun adıyla davet gitmesi
demekti; şablonları stüdyo adını parametre alacak şekilde yeniden yazıp yeniden onaylatmak gerekirdi.
Ayrı hesapta her stüdyo kendi metnini kendi onaylatır ve sabit metindeki isim **doğru** olur.
Bedeli müşteri başına 1-3 günlük Meta onayı; karşılığı, kimsenin başkasının adıyla mesaj almaması.

**Şimdi yapılmıyor.** Müşteri geldiğinde onun Meta süreçlerini biz yönetiriz; kod tarafı o zaman
açılır. Bugün alınan şey karardır, iş değil — ve karar alındığı için A1'e başlandığında hangi
modelin üzerine inşa edileceği tartışılmaz.

**A2 · E-posta göndericisi stüdyo başına.** Gönderici adresi `settings/studio` altına; SPF/DKIM her
müşterinin kendi alan adında. (Resend anahtarı platform genelinde kalabilir.)

**A1 gibi bu da müşteriye bağlı** (owner, 2026-08-09). Sebep aynı: işin yarısı bizde değil. SPF ve
DKIM kayıtları müşterinin kendi alan adına yazılır, o alan adının DNS'ine erişimi olan da müşteridir.
Müşteri yokken yazılacak kod, doğrulanamayan bir varsayımın üstüne oturur — gönderici adresi
çalışıyor mu, ancak o alan adından ilk e-posta gidince belli olur.

**Faz A'da müşteri beklemeden yapılabilecek olanlar A3 ve A4'tür.** İkisi de mevcut stüdyodan
bağımsız ve emülatörde baştan sona doğrulanabilir.

**A3 · Tek komutla stüdyo açma.** Bugün kurulum `tools/setup/*` ile elle yapılıyor. Bir müşteri için
kabul edilebilir, üç müşteri için değil. → `pnpm studio:new`, **idempotent** (yarıda kalırsa tekrar
çalıştırılabilsin).

**A4 · White-label mobil derleme parametreleri.** Stüdyo kimliği, uygulama adı ve ikonu derlemeye
parametre olarak verilmeli. Bugün `config.ts`'te `STUDIO_ID = 'retro'` sabit; koddaki not zaten bu
çatalı işaret ediyor. Bu yapılmazsa üçüncü müşteride tıkanılır (bkz. §8).

---

## 7. Home Assistant — ayrı bir iş kolu, ayrı ekonomi

Owner kendi stüdyosunda kullanıyor: kapı 5 dakika açık kalırsa klima kapanıyor, akşam olunca su
vanası kapanıyor. Planlanan: stüdyoya **mini PC ile yerel sunucu**, Zigbee cihazlar — klima kontrolü,
akıllı su vanası, kapı açık/kapalı sensörü, **insan varlığı radarı**.

**Bu bir SaaS özelliği değil, donanım + montaj işidir.** Bunu yazılım lisansına gömmek en pahalı
hatalardan biri olur:

- Müşteri başına **fiziksel donanım** (mini PC, Zigbee hub, sensörler, vana, röleler)
- **Yerinde montaj** — vana için tesisatçı, sensörler için yerleşim
- Donanım bozulur ve desteği **fiziksel** olur: mini PC ölürse oraya kim gidecek?
- Stüdyonun yerel ağı bir bağımlılık hâline gelir
- **Sorumluluk:** vana açık kalıp su basarsa kimin sorumluluğunda? Sözleşmede yer almalı.

**Ama gerçek bir fark yaratıcı.** Türkiye'de hiçbir stüdyo yazılımı bunu yapmıyor, ve bizim
sistemimizle doğal bir sinerjisi var: panel **içeride kim olduğunu zaten biliyor** (check-in, saatlik
`occupancySweep`, "İçeride" rozeti). Varlık radarıyla birlikte ikisi birbirini doğrular — panel
"içeride 0 üye" diyor, radar "boş" diyor → her şey kapanır. Bu bir gösteriş özelliği değil, gerçek
bir entegrasyon.

**Kurallar:**
1. **Ayrı fiyatlanır:** donanım (maliyet + marj) + montaj (bir kerelik) + isteğe bağlı yıllık izleme.
   Asla yazılım lisansına dahil değil.
2. **Ürün olmadan satılmaz.** Bugün owner'ın kişisel kurulumu. "Benim stüdyomda çalışıyor"dan
   "yabancı bir stüdyoya kurulabilir"e geçmek büyük bir adım: standart malzeme listesi, standart
   konfigürasyon, belgelenmiş montaj, uzaktan erişim, arıza senaryoları.
3. **Donanım SLA'sı farklıdır.** Yazılımda 2 saatte cevap; donanımda birinin gitmesi gerekir.
   Başlangıçta **sadece İstanbul** ya da şehir başına montaj ortağı.
4. **İkinci müşteriyi bloklamaz.** Roadmap'te Faz 2.3; orada kalır.

---

## 8. Mobil uygulama — white-label standart (owner, 2026-08-03)

Owner kararı: *"White-label olmalı, bu satışı ikna edecek güzel bir özellik."* Kabul — ama iki şey
şimdi karara bağlanmalı, yoksa üçüncü müşteride tıkanır.

**Geliştirici hesabı: BİZİM hesabımızda.** Sertifikaları biz yönetiriz, sürüm çıkarmak hızlı, müşteri
hiçbir şeyle uğraşmaz. Alternatifi (müşterinin kendi hesabı) her müşteriye yıllık 99 $ ve günlerce
kurulum yükler. Sözleşmeye: *"ayrılırsan uygulamayı devrederiz veya yayından kaldırırız."*

**Sürümler TOPLU çıkar.** 1.3.0'ı tek uygulama için çıkarmak yarım gün aldı (2026-08-03). Beş
müşteride her güncelleme bir haftaya yayılır. Kritik hata dışında ayda/çeyrekte bir, hepsi birden.
Derleme ve mağazaya yükleme zaten otomatik; eksik olan A4 (derleme parametreleri).

**Fiyat yıllık olmalı**, bir kerelik değil: mağaza incelemeleri, zorunlu SDK yükseltmeleri ve
iOS/Android kırılmaları her yıl geliyor. Kurulum ≈ bir yıllık lisans · yıllık bakım ≈ lisansın %30'u.

---

## 9. Alan adı (owner onayı, 2026-08-04)

**`studyoasistan.com` + `studyoasistan.com.tr`** — ikisi de alınacak.

Ürünün zaten adı bu (*Studio Yönetim Asistanı*), Türkçe, telefonda tarif edilebilir, ve alt alan adı
olarak düzgün okunuyor. "Panel" gibi jenerik değil: **asistan** kelimesi ürünün ne yapmaya çalıştığını
söylüyor — sistemi yönetmek değil, sahibin yerine iş takip etmek. AI resepsiyonist, patron asistanı ve
Home Assistant tarafı bu ismin altına doğal oturuyor.

**Yapı:** ortak platform alan adı + müşteri başına alt alan adı — `novozen.studyoasistan.com`. Tek
wildcard SSL, DNS işi yok, yeni müşteri dakikalar içinde açılır. Üye portalı ve public satış sayfası
da aynı alt alan adından servis edilir (`?s=` parametresi alt alan adından türetilir). Kendi alan
adını isteyene ayrıca sunulur ve **ücretlendirilir**.

Değerlendirilip elenen: `retrostudyo.com` (şirket adıyla bağlı ama müşteri bizim şirket adımızı değil
kendi işini yapan şeyi satın alıyor) · `studiopanel.com` (`.com` alınmış) · `seanspanel.com`.

---

## 10. Sıra

```
[şimdi]  PF/bug işleri
   ↓
Faz A   A1 WhatsApp · A2 e-posta · A3 studio:new · A4 mobil derleme parametreleri
   ↓
Operasyon  dış izleme · bakım penceresi · yedekten dönüş provası · hibrit+POS canlı test
   ↓
Ticari   alan adı + wildcard SSL · sözleşme + SLA metni
   ↓
[Novozen — tasarım ortağı, indirimli]
   ↓
Faz B   platform_admin ekranı + destek merkezi · lisans takibi
   ↓
[3. müşteri]  →  Home Assistant ürünleştirme (§7)
```

---

## 11. Hâlâ karara bağlanmamışlar

- **Lisans bandı sınırları** — ≤150 / 150–400 / 400+ önerildi, üç kademenin fiyat farkı netleşmedi.
- **AI tavanı** — aylık kaç konuşma dahil, aşım birim fiyatı ne?
- **Gecikmiş ödemede ne olur** — okuma-yazma kısıtı mı, uyarı mı? (Bir stüdyonun günü buna bağlı;
  panel kapatmak, o gün işini yapamayan bir işletme demek.)
- **KVKK/veri işleyen sözleşmesi** — platform biletlerindeki üye verisi (§5).
- **Home Assistant sorumluluk sınırı** — su vanası ve klima binaya dokunuyor (§7).
