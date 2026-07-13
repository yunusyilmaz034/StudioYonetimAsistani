# Product Alpha — Feature Parity

**Status:** ✅ **DEVELOPMENT COMPLETE** — v1.27, tagged `v1.27-product-alpha`
**Owner:** Yunus · **Rule set:** 2026-07-13

Seven sprints (S1–S7), every parity item closed, **every Alpha gap closed**. What remains before the
studio can switch is not engineering: it is a Meta contract, a DNS record and a production project —
all listed, with their go-live steps, in [`EXTERNAL-DEPENDENCIES.md`](EXTERNAL-DEPENDENCIES.md).

**The gate at closure:**

| | |
|---|---|
| `pnpm check` | ✅ 517 unit tests · 0 dependency violations · typecheck + lint clean |
| `pnpm test:golden` | ✅ 64 event-payload fixtures — **no event schema changed in Alpha** |
| `pnpm test:integration` | ✅ 33 emulator tests (rules · triggers · health · member-portal e2e) |
| `next build` | ✅ compiled |

**Next:** Alpha Review → end-to-end scenarios → monkey/stress → bug fix → **Alpha Freeze.** No new
features.

---

## 1. What Alpha is for

> **Alpha is not about adding features. It is about a studio that runs on BulutGym today being able to
> move to this system without losing a single daily operation.**

**Parity first.** No AI, no Commerce, no Automation, no Retail until every operation the studio
actually performs, every day, exists here — and is better.

"Better" is the whole point. We are not cloning BulutGym; we are replacing it. Where we can do the
same job with fewer clicks, or with a record BulutGym never kept, we do — but **we do not skip the
job.**

---

## 2. The one question

Before ANY item enters this backlog:

> ### “Is this actually used in BulutGym today?”

| Answer | Where it goes |
|---|---|
| **Yes** | **Product Alpha backlog** — it is a parity requirement |
| **No** | **Product Plus backlog** — it is a capability, and it waits |

**Product Plus (frozen until parity is reached):** Undo / Recovery · Time Travel / Replay · Commerce
(iyzico, PayTR, e-Fatura) · Retail & Wallet · AI Studio Manager · Automation · Multi Studio ·
Training & Progress.

Every one of these is designed, some are documented (Doc 25, Doc 27), and **none of them is started.**
That is the correct state.

---

## 3. Feature Parity Checklist

**Legend:** ✅ done · 🔵 partial (works, incomplete) · ❌ missing · ⚠️ exists but *lies*

### Üye

| Operation | Status | Reality |
|---|---|---|
| Üye oluştur / düzenle / pasife al | ✅ | `/members` + `/members/[id]`, E.164, çakışma reddi |
| Üye geçmişi (timeline) | ✅ | Member workspace → İşlem Geçmişi, Türkçe cümlelerle |
| İşlem geçmişi (paket/rezervasyon/ödeme) | ✅ | Üç ayrı timeline, hepsi event log üzerinden |
| **Pasif üyeler listesi** | ❌ | Üye listesinde **sadece ad/telefon araması var — durum filtresi yok** |
| **Bitecek üyelikler listesi** | 🔵 | Dashboard'da widget var; **kendi listesi/ekranı yok** |
| **Donmuş üyeler listesi** | ❌ | Dondurma S3'te geldi; **listesi yok** |
| **Üyelik raporları** | ❌ | Bkz. Raporlar |
| KVKK anonimleştirme | 🔵 | CLI'da var (`pnpm kvkk:erase`), **ekranda yok** |

### Rezervasyon

| Operation | Status | Reality |
|---|---|---|
| Ders oluştur / iptal / eğitmen-oda-kontenjan değiştir | ✅ | Session workspace |
| Rezervasyon oluştur / iptal | ✅ | Takvim + üye workspace |
| Rezervasyon taşı (D19 — tek event, iptal+yeni değil) | ✅ | |
| Sabit/tekrarlayan rezervasyon | ✅ | Jeneratör (D18) |
| Bekleme listesi | ✅ | Katılma/ayrılma/terfi — **otomatik terfi yok** (DEBT-018) |
| Haftayı tekrarla (ders kopyalama) | ✅ | |
| Tatil/kapanış operasyonu (toplu ders iptali) | ✅ | Preview → onay → uygula |
| **Toplu rezervasyon oluşturma** | ❌ | Tek üye, tek ders. Çoklu üye seçimi yok. |
| **Toplu rezervasyon silme** | ❌ | Yalnızca kapanış operasyonu (bir güne/aralığa özel) |
| **Toplu eğitmen değiştirme** | ❌ | Tek ders için var |
| **Toplu ders taşıma** | ❌ | |

### Paket & Satış

| Operation | Status | Reality |
|---|---|---|
| Katalog CRUD (fiyat, süre, kredi, dondurma hakkı) | ✅ | `/packages` |
| Paket satışı + ödeme (nakit/kart/havale/POS/gift card) | ✅ | Üye workspace → Paketler / Cari hesap |
| Kısmi ödeme · çoklu ödeme | ✅ | Allocation ile |
| İade · void · satış iptali | ✅ | Owner-only |
| **Paket dondurma** | ✅ | S3. Bütçe tavan, gecelik otomatik çözme, rezervasyon varsa reddet |
| Kasa · gün sonu (fark açıklamasız kapanmaz) | ✅ | `/finance` |
| **Makbuz / bilgi fişi** | ✅ | `/receipt/[kind]/[id]` — yazdırılabilir, şirket bilgileri S2'den, *"Bu belge mali belge değildir."* |
| Taksit planı | 🔵 | Plan kaydediliyor; ödenen taksit işaretlenmiyor (DEBT-022) |

### Check-in

| Operation | Status | Reality |
|---|---|---|
| QR üret (üye portalı) · QR okut · check-in/out | ✅ | 60 sn, imzalı, tek kullanımlık |
| Manuel arama ile check-in | ✅ | Offline `/commands` yolunda |
| Şube aç/kapat · anlık doluluk | ✅ | |
| **Tablet / kiosk ekranı** | ✅ | `/checkin/kiosk` — tam ekran, navigasyonsuz, otomatik sıfırlanan, üye tarafından kullanılan |
| **iPad'de QR okuma** | ✅ | jsQR, tek implementasyon, `lib/qr/scanner.ts` port'unun arkasında. iPad ve Android **birebir aynı davranıyor** |
| Offline check-in | ✅ | Manuel arama offline `/commands` yolunda. Kiosk bağlantı kesilince **bunu söylüyor** ve isimle girişe yönlendiriyor — çalışmayan bir kamerayı göstermiyor |

### Dashboard & Hareket Merkezi

| Operation | Status | Reality |
|---|---|---|
| **Hareket Merkezi (Activity Feed)** | ✅ | **Zaten var** — dashboard'da canlı akış + `/activity` tam ekran, **insan diliyle** |
| Son işlemler | ✅ | Aynı akış |
| Kritik uyarılar ("bugün ilgilenmen gerekenler") | ✅ | `needsAttention` bloğu |
| Günlük özet (dersler, gelenler, bekleyen ödemeler, kasa) | ✅ | 17 widget |
| Audit (owner-only, teknik) | ✅ | `/audit` — **Activity Feed'den ayrı, öyle kalacak** |

### Raporlar — **v1.27 S6'da kapandı**

Yedisi de tek bir ekranda (`/reports`), tek tarih aralığı, tek tablo, tek export. **Owner-only** —
resepsiyon finans raporu almaz ve toplu export sahibindir (owner, 2026-07-13); yapısal export testi
bunu zaten zorluyor.

| Report | Status | Sorduğu soru |
|---|---|---|
| Üyelik raporu | ✅ | Kim üye, paketi ne durumda, ne zaman bitiyor? *(anlık durum — tarih aralığından etkilenmez, ekran bunu söylüyor)* |
| Satış raporu | ✅ | Ne sattık (`soldAt`), ne kadarı tahsil edildi, ne kadarı bekliyor? |
| Tahsilat raporu | ✅ | Kasaya ne girdi (`receivedAt`), hangi yöntemle, kim aldı? |
| Rezervasyon raporu | ✅ | Kim geldi, kim gelmedi — ve **kaçını kimse işaretlemedi** (`system_default`) |
| Eğitmen raporu | ✅ | Kaç ders, ne doluluk? *(Ciro yok: sistem ciroyu eğitmene bağlamıyor — `soldBy` satan kişidir, başka bir soru)* |
| Gün sonu raporu | ✅ | Tek gün, yazdırılabilir: dersler, gelenler, para, kasa farkı |
| Kasa raporu | ✅ | Açılış, sayım, **fark** — kaydedilir, asla yutulmaz |

**Satış ≠ tahsilat.** Biri anlaşılan, diğeri alınan paradır; birini diğeriyle cevaplamak bir stüdyonun
iyi bir ay geçirdiğini sanmasının yoludur. İki ayrı rapor, tam da bu yüzden.

### Operasyon

| Operation | Status |
|---|---|
| Gün sonu (kasa sayımı, fark açıklaması) | ✅ |
| Bekleyen işler | 🔵 dashboard'daki `needsAttention` |
| Açılış checklist | ⬜ | *Bu fazın kapsamı dışında (owner, 2026-07-13)* |
| Kapanış checklist | ⬜ | *Bu fazın kapsamı dışında (owner, 2026-07-13)* |
| **Sistem uyarıları (ekranda)** | ✅ | Beş sinyal `/operations` ekranının **en üstünde**, canlı çalışıyor. Kontroller core'a taşındı: **nightly job ile ekran aynı kodu** çalıştırıyor. Uyarılar **bildirilir, asla onarılmaz** — bir sayıyı sessizce düzeltmek, hatanın tek kanıtını silmektir |
| Toplu paket işlemleri (+gün / +kredi, zorunlu gerekçe) | ✅ |
| **Toplu rezervasyon iptal / taşı** | ✅ | `/reservations/bulk` — önizle → uygula, isimli liste |
| **Toplu eğitmen değiştir** | ✅ | Tarih aralığı + zorunlu sebep; her `session.trainer_changed` event'ine damgalanır |

### Bildirim

| Channel | Status |
|---|---|
| Sistem bildirimleri (in-app) | ✅ |
| Bildirim Merkezi ekranı | ✅ |
| E-posta | ✅ Resend (API key + DNS bekliyor) |
| **WhatsApp** | ❌ | Port + Meta template eşlemesi hazır; **gerçek transport yok** |
| Bildirim ayarları ekranı | ✅ | Sessiz saat · günlük tavan · e-posta. `in_app` kapatılamaz. |

---

## 4. What is actually missing — the honest list

Ordered by *how much a receptionist's day hurts without it*.

1. ~~**Raporlar — hiçbiri yok.**~~ ✅ *S6 — yedi rapor, tek ekran.*
2. ~~**Toplu rezervasyon işlemleri.**~~ ✅ *S7*
4. ~~**Üye listesi filtreleri**~~ ✅ *S7 — pasif · donmuş · bitecek · kredisi azalan · paketsiz · borçlu*
5. **WhatsApp.** → *kod tarafı bitti; Meta kimlik bilgisi bekliyor — bir mühendislik eksiği değil, bir sözleşme eksiği. Bkz. `EXTERNAL-DEPENDENCIES.md` ED-1*
6. ~~**Sistem uyarıları bir ekranda.**~~ ✅ *S7 — Operasyonlar ekranının en üstünde, canlı*
7. **Açılış / kapanış checklist.** → *bu fazın kapsamı dışında (owner)*
8. ~~KVKK ekranı · BulutGym import ekranı.~~ ✅ *S5*
9. ~~Çalışma saatlerinin rezervasyon motorunda uygulanması (AG-1).~~ ✅ *Alpha kapanışında kapatıldı*

   İki kapı: **ders oluşturma** ve **rezervasyon** (saatler *değişir* — dün 22:00'de kapanan bir
   stüdyonun takviminde geçen ayın 21:30 dersleri hâlâ durur, ve oraya yeni üye yazılmamalı).
   **Takvim kazanır:** `special_working_day`, o tarihte haftalık saatleri geçersiz kılar — stüdyo
   yazılı olarak "o gün açığız" demiştir. Guard **zorunlu bir bağımlılık**: unutmak derleme hatası
   verir. Bağlarken **üye portalını** ve **bekleme listesi terfisini** yakaladı — ikisi de rezervasyon
   yaratıyor ve ikisini de kimse düşünmemişti.

---

## 5. Sprints

**S1 — Staff & Identity** ✅ *Done*
Personel yönetimi · bootstrap owner · yetkilendirme (rol matrisi) · eğitmen ekranı

**S2 — Studio Settings** ✅ *Done*
Şirket bilgileri ✅ · çalışma saatleri ✅ · rezervasyon kuralları ✅ · QR ayarları ✅ · tatil takvimi
✅ *(`/calendar` — ikinci bir liste yazmadık)* · **bildirim ayarları ✅ (DEBT-024 kapandı)**

**S3 — Sales** ✅ *Done*
Satış akışı ✅ · tahsilat ✅ · paket kuralları ✅ · **paket dondurma ✅** · **makbuz / bilgi fişi ✅**

**S4 — Reception** ✅ *Done*
Tablet / kiosk ekranı ✅ · **platform-bağımsız QR okuyucu (jsQR) ✅** · offline davranışı ✅ ·
otomatik sıfırlama ✅ · resepsiyon ekranı ✅ · check-in penceresi ayarı artık **gerçekten çalışıyor**

**S5 — KVKK & Import** ✅ *Done*
KVKK anonimleştirme ekranı ✅ *(iki adımlı, adı yazarak onay; `platform_admin` — domain reddediyor,
ekran değil)* · BulutGym import ekranı ✅ *(owner-only)* · import raporu ✅ *(satır numarası + Türkçe
red sebebi)* · veri doğrulama ✅

Tek bir kural seti: doğrulama artık `members/domain/import.ts`'de. Break-glass script ve ekran
**aynı kodu** çalıştırıyor — iki doğrulayıcı, *"bu satır üretime girebilir mi?"* sorusuna iki cevaptır
ve biri yanlıştır. Aynı şekilde PII temizliği tek bir `FirestorePiiPurger`.

**Bir kötü satır tüm koşumu durdurur.** Yarım import, *neredeyse* doğru bir üye listesi bırakır ve
hangi yarısının eksik olduğunu kimse bilemez.

**S6 — Reports** ✅ *Done*
Üyelik ✅ · satış ✅ · tahsilat ✅ · eğitmen ✅ · rezervasyon ✅ · gün sonu ✅ · kasa ✅.

Hepsi v1.23'ün **`ExportableTable` sözleşmesi** üzerinde: bir rapor sütunlar ve satırlardır, dosya
formatı bir *detaydır*. CSV bugün var; Excel/PDF birer **writer** olacak, yeni ekran değil. Yazdırma
`window.print()` + stylesheet — gün sonunu yazdırıp çekmeceye koymak için PDF kütüphanesi almak,
karşılığı olmayan bir bağımlılıktır.

Kurucular **saf** (`lib/reports/build.ts`, 8 test): tabloda sessizce yanlış olan bir sayı, olmayan bir
rapordan kötüdür — çünkü ona inanılır. Para hücreye **sayı** olarak girer (`300`, `'300,00 ₺'` değil);
biçimlenmiş metin Excel'e metin olarak düşer ve owner'ın `SUM()`'ı sessizce sıfır döner.

**S7 — Bulk Operations & Lists** ✅ *Done*
Toplu rezervasyon iptal ✅ · toplu taşı ✅ · toplu eğitmen değiştir ✅ · üye listesi filtreleri ✅ ·
sistem uyarıları ekranı ✅.

*(Açılış/kapanış checklist bu fazın kapsamında değil — owner, 2026-07-13.)*

**Toplu işlemler: önizle → uygula.** Önizleme bir özet değil, **isimli bir liste**: *"8 kişi
etkilenecek"* kimsenin doğrulayamayacağı bir sayıdır; *"Ayşe — kredisi iade edilir. Fatma — GEÇ
İPTAL, kredisi yanar."* bir karardır. Planlayıcı **saf** ve uygulamayla **aynı deciders**'ı çalıştırır
— kuralı kendi kelimeleriyle yeniden yazan bir önizleme, bir gün önizlediği eylemle çelişir ve
ekranda olduğu için ona inanılır.

Toplu taşımada **kontenjan sırayla dolar**: hedefte 3 yer varken 8 kişiyi tek tek orijinal sayaca göre
değerlendirmek sekizini de kabul eder, sonra uygulama beşini reddeder — resepsiyon o beş kişiye çoktan
"Çarşamba dersindesiniz" demiştir.

**Her kalem kendi transaction'ı; rollback yok ve olmamalı.** Altı iptal, altı gerçek kredi hareketidir;
yedincinin başarısız olması ilk altısını geri almaz. Borç olan şey **sonrasındaki gerçektir**: hangisi
oldu, hangisi olmadı, neden.

---

## 6. Hareket Merkezi — the clarification

**It already exists, and it is already in human language.** The dashboard carries a live feed and
`/activity` is the full screen; a presenter turns all 70+ event types into Turkish sentences, and an
event type with no sentence **fails the build**.

> Ayşe 8 derslik Reformer paketi satın aldı.
> Fatma rezervasyonunu iptal etti.
> Reyhan rezervasyonu Çarşamba 19:00'a taşıdı.
> Elif check-in yaptı.
> Hakkı doldu, sistem üyeliği devam ettirdi.

**Audit stays separate**, owner-only, technical, with before→after. That separation was made in v1.22
and it holds: *the Activity Feed is what happened; the Audit is what changed.*

What S7 adds is the **daily summary line** ("Bugün 3 yeni üye kaydı oluşturuldu") — an aggregate, not
an event, and therefore a widget rather than a feed row.
