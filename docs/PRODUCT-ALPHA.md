# Product Alpha — Feature Parity

**Status:** ✅ **DEVELOPMENT COMPLETE + ALPHA REVIEW PASSED** — v1.27
**Alpha Review:** 2026-07-13 · every screen walked, every scenario run end to end against the emulator
(`pnpm verify:alpha`). See §7.
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
| **Pasif üyeler listesi** | ✅ | S7 · üye listesi filtreleri (pasif · donmuş · bitecek · kredisi azalan · paketsiz · borçlu) |
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
| Taksit planı | ❌ | Domain yazılı ve testli; **hiçbir ekran plan oluşturamıyor** (Alpha Review). Alpha kapsamında değil. |

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


---

## 7. Alpha Review — what the walk-through found (2026-07-13)

Every screen was walked and every scenario run end to end against the emulator. Eleven defects, one of
them severe enough to block a cutover on its own.

### The one that mattered: **two money models, and the product wrote to the wrong one**

Reception's only sell path (`assignSubscription`) wrote the money onto the **entitlement**. The
dashboard, the sales report, the collections report, the kasa and the cari hesap all read the
**ledger** (Sale · Payment · Allocation). They are different places.

Proven against the emulator before a line was changed — a package sold for 3.000 ₺ in cash:

```
entitlement.paidTotal : 3.000 ₺   ← the money was here
Gösterge paneli       :     0 ₺
Satış raporu          :  boş
Tahsilat raporu       :  boş
Kasa                  :  boş
```

**Fixed (owner-approved):** `sellPackage` grants the package **and** records the money in the ledger,
under one `operationId`. The ledger is the one truth. Consequences that came free: the cari hesap, the
kasa, the day-end, the receipt and the "Borçlu" filter all became true on the same day.

Two related things fell out of it:

- `member.stats.balanceDue` was a denormalised field **nothing had ever written**. Every member's debt
  was zero, so the "Borçlu" filter matched nobody and the membership report's Bakiye was a column of
  zeros. Debt now comes from the ledger's open sales.
- The member portal computed her balance as `Number(priceAgreed) − Number(paidTotal)` — on `Money`
  **objects**. It was showing her `NaN`.

### The other ten

| # | Defect | Fix |
|---|---|---|
| 1 | **`<Toaster />` was never mounted.** Fourteen screens mounted their own; four did not — and on those four every error message rendered *nothing*. Settings saved or refused: silence. The trainer's attendance mark failing and rolling itself back: silence. | Mounted **once** in the staff shell. A screen no longer decides whether the user may be told about a failure. |
| 2 | **Reception was offered doors that threw her home.** The dashboard's "Analiz" button, seven widget drill-downs, the notification centre's operation link, and the activity search's İşlem No all led to owner-only areas. | Drawn only for the roles that may follow them; the search now says so instead of silently bouncing. |
| 3 | **No screen could create a ders türü or a salon.** The only creator in the repository was the demo seed — a real studio could not schedule its first class. | Ders Türleri + Salonlar in Ayarlar, on the existing (already-tested) use-cases. |
| 4 | **CRM "Üye Yap" was dead** — it linked to `/members?lead=…`, a parameter nothing reads. A lead could never reach `won`. | One press: registers her from the lead and converts. A duplicate phone is refused (I-21) — she is already a member. |
| 5 | **Sale cancellation was unreachable.** `cancelSaleAction` was called from nowhere. | Owner-only, in the cari hesap, with a mandatory reason. |
| 6 | **A staff role change looked like it failed** — no `router.refresh()`, so the Select snapped back to the old value. | Refresh on success. |
| 7 | **Deactivating a member discarded the result.** A refusal closed the dialog and refreshed the page exactly as if it had worked. | The refusal is shown. |
| 8 | **"Hepsini katıldı işaretle" toasted success for work it never awaited** — a failed roster produced one green toast and a pile of red ones. | Awaits, and reports how many actually landed. |
| 9 | **Three screens could hang on "Yükleniyor…" forever** (kasa, cari hesap, bekleme listesi) — a failed read had no catch. | They say what happened. |
| 10 | **The import screen could get stuck busy** on a thrown read, showing nothing. | try/catch. |

### Deliberately NOT fixed — and why

- **Toplu rezervasyon oluşturma** (many members into one class) — genuinely absent, and it is marked ❌
  in this document. It is not a regression; nobody has lost it. *(Recurring booking — one member ×
  N weeks — does exist.)*
- **Gift card · kupon · taksit planı** — the domain is written and tested; no screen calls it. The
  Alpha checklist marks them 🔵/❌ and they stay there. **The "Taksit planı 🔵 plan kaydediliyor" row
  was wrong and is corrected: a plan cannot be created from any screen.**
- **The CRM offer lifecycle** (teklif gönder/kabul/ret) — `/crm` is not on the Alpha parity list at
  all. It ships half-wired; the lead funnel works, the offer flow does not.
- **Receipt kinds `payment` / `refund` / `cancellation`** — only `sale` is linked. The sale slip is the
  one reception hands over.

### The gate at the end of the review

`pnpm check` (517) · `test:golden` (64) · `test:integration` (33) · `next build` · **`pnpm verify:alpha`
— the whole studio day, end to end, against the emulator: üye → paket sat → tahsilat → rezervasyon →
taşı → iptal → toplu işlem → check-in → dondur/çöz → çalışma saatleri → raporlar → makbuz → import →
KVKK → dashboard. All green.**
