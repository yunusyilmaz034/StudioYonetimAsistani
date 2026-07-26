# Ürün Yol Haritası — tek stüdyodan çok müşterili ürüne

**Durum:** owner onaylı yön · **acele yok** (2026-07-26). Novozen adlı bir pilates stüdyosu "bize de
kurun" dedi ama görüşme ciddi bir aşamada değil. Sıra: **önce elimizdeki PF/bug işleri bitecek**,
sonra buraya geçilecek.

**Hedef:** aynı sistemi ikinci, üçüncü, beşinci stüdyoya **yıllık lisans** ile satabilmek.

---

## Karar: TEK kod tabanı. Müşteri başına ayrı sistem YOK.

Ayrı sistem kurmak, yapılmış işi çöpe atmaktır. İkinci müşteride her hata iki yerde düzeltilir, her
özellik iki kez yazılır, Novozen için yapılan iyileştirme ilk stüdyoya hiç ulaşmaz; beşinci müşteride
bakım imkânsızlaşır. **Yeni müşteri = yeni bir `studioId`**, yeni bir sistem değil.

Bu karar zaten mimarinin ilk cümlesi: *"İlk müşteri bir Pilates stüdyosu; tek müşteri değildir ve
hiçbir kod öyle varsayamaz."* (CLAUDE.md). Bir yıl boyunca tutulmuş.

### Ölçüm (2026-07-26) — sistem ne kadar hazır?

Kodda sabitlenmiş stüdyo izi taraması: **4 eşleşme — ikisi yorum satırı, ikisi varsayılan `studioId`
değeri.** Başka hiçbir yerde "retro" ya da müşteri adı geçmiyor.

| Stüdyo başına ayarlanabilir mi? | Durum |
|---|---|
| Ödeme sağlayıcı (PAYTR merchant, test modu, callback) | ✅ `settings/paymentProvider` |
| Tema, marka, logo, adres, yol tarifi | ✅ `settings/studio.company` + tema |
| Paketler, fiyatlar, kart farkı, politikalar | ✅ katalog + policy (AD-41: katalog VERİDİR) |
| AI bilgi kartı (persona, SSS, politika) | ✅ `settings/ai` |
| Bildirim şablonları | ✅ `notificationTemplates` (stüdyo override'ı) |
| Yetki matrisi, roller, personel | ✅ studio-scoped |
| Veri izolasyonu | ✅ her şey `/studios/{sid}/…`, güvenlik kuralları studio-scoped |
| **WhatsApp numarası** | ❌ ORTAK (`process.env.WHATSAPP_PHONE_NUMBER_ID`) |
| **E-posta gönderici adresi** | ❌ ORTAK (`process.env.EMAIL_FROM`) |

---

## Faz A — ikinci müşteri teknik olarak mümkün olsun

Bu üçü olmadan Novozen kurulamaz; gerisi konfordur.

### A1 · WhatsApp numarası stüdyo başına
Şu an numara ve token ortam değişkeninde: Novozen'in üyesine mesaj **ilk stüdyonun numarasından**
gider. Her stüdyonun kendi Meta WABA hesabı, kendi numarası ve kendi şablon onayları olmalı.
→ `settings/whatsapp` dokümanı (phoneNumberId + token referansı); token Secret Manager'da stüdyo
başına ayrı secret. Webhook zaten `/{studioId}` yolunu okuyor, o taraf hazır.
**Dikkat:** şablonlar Meta'da hesap başına onaylanıyor — her yeni stüdyo kendi onay sürecini yaşar
(1-3 gün). Kurulum takvimine yazılmalı.

### A2 · E-posta gönderici stüdyo başına
`noreply@pilatesfitnessbyisil.com` bütün stüdyolara gidiyor olur. → gönderici adresi `settings/studio`
altına; SPF/DKIM her müşterinin kendi alan adında. (Resend API anahtarı platform genelinde kalabilir.)

### A3 · Tek komutla stüdyo açma
Bugün kurulum `tools/setup/*` script'leriyle elle yapılıyor (katalog, egzersizler, ödeme sağlayıcı,
eğitmenler, AI kartı…). Bir müşteri için kabul edilebilir, üç müşteri için değil.
→ `pnpm studio:new` — stüdyo dokümanı, şube, varsayılan katalog, varsayılan politika, AI kartı
taslağı, owner hesabı. **Idempotent olmalı** (yarıda kalırsa tekrar çalıştırılabilsin).

---

## Faz B — satılabilir ürün

### B1 · Alan adı stratejisi
Bugün `panel.pilatesfitnessbyisil.com` tek müşteriye ait. Önerilen: **ortak platform alan adı + alt
alan adı** — `novozen.<platform>.com`, `isil.<platform>.com`. Tek wildcard SSL, DNS işi yok, yeni
müşteri dakikalar içinde açılır. Kendi alan adını isteyene ayrıca sunulur ve **kurulum ücreti**
alınır. (Üye portalı ve public satış sayfası da aynı alt alan adından servis edilir; `?s=` parametresi
alt alan adından türetilir.)

### B2 · Platform yönetim paneli (`platform_admin`)
Rol var, ekran yok. Gereken: stüdyo listesi, lisans başlangıç/bitiş, üye ve işlem hacmi, **AI ve
mesaj maliyeti** (müşteri başına), sağlık durumu (mevcut health check'ler zaten çok stüdyoluyu
destekliyor — `allStudioIds`). Üçüncü müşteriden önce şart değil, ama beşincide zorunlu.

### B3 · Lisans ve faturalama
Yıllık lisans takibi: başlangıç, bitiş, yenileme hatırlatması, gecikmede ne olur (okuma-yazma kısıtı
mı, uyarı mı — **karar gerekiyor**). Faturalama muhtemelen sistem dışında (muhasebe), ama lisans
durumu sistemde tutulmalı.

---

## Ticari uyarılar (mimari kadar önemli)

**AI maliyeti müşteriye göre değişir.** WhatsApp resepsiyonisti konuşma başına ücretlendiriliyor
(ilk stüdyoda ~6 $/ay, önbelleklemeden sonra). Yoğun bir stüdyo bunun birkaç katını harcar. Sabit
yıllık lisansa dahil edilirse **riski platform taşır**. Ya kullanım tavanı konmalı, ya AI ayrı bir
paket olmalı.

**Kurulum gerçek bir emektir.** Her stüdyo için: PAYTR sözleşmesi, Meta WhatsApp hesabı + şablon
onayları, katalog girişi, üye/paket aktarımı, personel hesapları, tema. "Lisansa dahil" sayılırsa her
müşteride günler gider. **Kurulum ücreti + yıllık lisans** olarak ayrılmalı.

**Veri taşıma her müşteride çıkacak.** İlk stüdyoda 119 üye + paketler elle/CSV ile taşındı ve hâlâ
sürüyor. Bu, satışın parçası olacak — `tools/migration` bir kereye mahsus değil, **ürünün özelliği**.

---

## Sıra

```
[şimdi]  PF/bug işleri  →  A1 · A2 · A3  →  B1  →  (3. müşteri)  →  B2 · B3
```

**Faz A tamamlanmadan ikinci müşteri kurulmamalı** — kurulursa mesajları ilk stüdyonun numarasından
gider ve geri dönüşü olmayan bir karışıklık doğar.
