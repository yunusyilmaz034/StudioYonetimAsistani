# WhatsApp Bildirimleri — Kurulum ve Anti-Spam Stratejisi

> Durum (2026-07-17): Bildirim hattı (intent → attempt → retry → sessiz saat → günlük tavan →
> Bildirim Merkezi → şablon yönetimi) ve Meta Cloud API transport'u **koda hazır**. WhatsApp şu an
> **mock** — gerçek gönderim için tek eksik: (1) Meta işletme kurulumu + kimlik bilgileri,
> (2) Meta'da onaylı şablonlar. İkisi de owner'ın sürecidir. Kod tarafında son adım tek satır (secret
> bağlama), o da secret'lar Secret Manager'da oluşunca yapılır.

---

## 1) Anti-spam stratejisi — neden numaramız banlanmaz

WhatsApp, e-postadan çok daha katıdır: kötü kullanım Meta'nın **kalite puanını** düşürür ve numaranız
kısıtlanır/banlanır. Bizim hattımızda bunu önleyen **altı katman zaten kurulu**:

1. **Üye bazında opt-in.** WhatsApp her üye için **varsayılan KAPALI** (`DEFAULT_PREFS.whatsapp=false`).
   Üye telefonunu verse bile, açıkça izin vermeden WhatsApp gitmez.
2. **İşlemsel vs pazarlama ayrımı (KVKK).** Tüm otomatik bildirimler **`operational`** (işlemsel:
   rezervasyon, iptal, hatırlatma, ödeme). Bir **pazarlama/kampanya** mesajı WhatsApp'tan **yalnızca
   üyenin açık kampanya izniyle** (`prefs.campaign`) çıkar; izin yoksa `no_consent` ile bastırılır.
3. **Sessiz saatler.** Acil olmayan mesaj 22:00–08:00 arasında bekler, sabah gider. "Dersiniz iptal
   edildi" (urgent) beklemez.
4. **Günlük tavan.** Bir hata yüzünden üyeye yüzlerce mesaj gitmesini engelleyen üst sınır.
5. **Toplu işlem = tek mesaj.** 12 dersi iptal eden bir kapanış, 12 değil **1** mesaj gönderir
   (`collapseByOperation`).
6. **Sadece Meta-onaylı UTILITY şablonları.** Serbest metin göndermeyiz; Meta'nın onayladığı işlemsel
   şablonları kullanırız — spam olarak işaretlenme riski en düşük kategori.

### Owner'ın vereceği iki karar (öneri ile)

- **A. Üye WhatsApp opt-in'i nasıl toplanır?** Öneri: kayıt/portalda "WhatsApp'tan bildirim almak
  istiyorum" onayı. İşlemsel mesajlar için varsayılanı AÇIK yapmak istersen (üye numarasını zaten
  stüdyo iletişimi için verdi) bu bir KVKK kararı — söyle, `DEFAULT_PREFS.whatsapp`'ı ona göre ayarlarım.
- **B. Hangi olaylar WhatsApp'a gitsin?** Kalite puanını korumak için **hepsi değil.** Öneri:
  yüksek değerli/zaman-hassas olanlar WhatsApp + e-posta; düşük değerliler sadece e-posta/uygulama-içi.
  (Aşağıdaki tabloda ⭐ ile işaretli.) Onaylarsan bunu koda **olay-bazlı WhatsApp izin listesi** olarak
  eklerim.

### Derin anti-spam: üst üste ve toplu gönderimi engelleme (araştırma, 2026)

Meta'nın kendi kuralları (kaynaklar: [Meta Messaging Limits](https://developers.facebook.com/docs/whatsapp/messaging-limits/),
[WhatsApp Spam Policy 2026](https://www.whatsable.app/blog/whatsapp-spam-policy-explained-for-businesses-in-2026),
[Messaging limits/quality](https://chatarmin.com/en/blog/whats-app-messaging-limits)):

- **Kullanıcı başına ~2 pazarlama mesajı/gün** üst sınırı (aşılırsa Meta hata **131049** döner).
- **Saatte 60+ mesaj** hesabı "Danger" bölgesine sokar.
- **Blok oranı %2–3'ü** geçerse **kalite puanı** düşer (Green→Yellow→Red); Red'de limit her an kısılır.
- Yanıt/gönderim oranı %15 altı "Low" sayılır; sabit aralıklarla ilgisiz kişilere göndermek bot gibidir.

Bunlara karşı **tasarım** (canlıya geçişte / owner parametre onayında uygulanacak; hepsi DATA — kodda
sabit sayı yok, #4). Kod yeri: `packages/core/.../notifications/domain/decide.ts` (yeni saf kararlar)
+ `application/notify.ts` (son gönderimden önce kontrol) + `on-event-notify.ts` (toplu pacing).

1. **Üye başına frekans tavanı + minimum aralık (üst üste engelleme).** Aynı üyeye WhatsApp'tan
   **kısa aralıkla arka arkaya** mesaj gitmez. Öneri (ayardan): **min 90 sn aralık**, **günde en çok
   6 işlemsel** WhatsApp/üye. Aşılırsa mesaj **uygulama-içi/e-postaya düşürülür** (kaybolmaz) veya
   pencerede birleştirilir. Saf karar: `decideRecipientRate(recentSends, now, policy) → allow|defer|drop-to-other-channel`.
2. **Toplu gönderim pacing (throughput throttle).** Bir kapanış 100 üyeyi bildirecekse **anında 100
   mesaj atmayız** (saatte 60 = Danger). Öneri: WhatsApp çıkışını **≤ ~40/saat** ile sınırla, bursts'ü
   zamana yay (kuyruk + `notificationRetry` sweep'i zaten var; buna WhatsApp hız kapağı eklenir).
   Not: zaten **toplu işlem = üye başına 1 mesaj** (`collapseByOperation`) var; bu, o 1 mesajların
   *hepsinin aynı anda* çıkmasını da engeller.
3. **Olay-bazlı WhatsApp izin listesi.** Her olay WhatsApp'a gitmez — sadece ⭐'lı yüksek-değerli/
   zaman-hassas olanlar. Düşük değerliler (kredi azaldı, ödeme alındı) e-posta/uygulama-içi kalır.
   Kod: `NotificationTemplate`'e opsiyonel `channels` beyaz-listesi; `selectChannels` onunla kesişir.
4. **Pazarlama: haftada ≤ 2**, her zaman kampanya izni + **kolay çıkış** ("Bildirimleri durdurmak için
   DURDUR yazın" / portalda kapatma). İşlemsel mesajlar bu sınırın dışında ama onlar da (1) ve (2)'ye tabi.
5. **Kalite izleme.** Meta webhook'undan blok/şikayet oranı + kalite puanı okunur; puan düşerse WhatsApp
   otomatik throttle'lanır (Faz sonrası; şimdilik manuel izleme + panelde uyarı).
6. **Etkileşim-farkında (sonraki faz).** Son X günde aktif olmayan üyeye sabit aralıkla gönderme;
   önce etkileşen üyelere. Şimdilik tasarım notu.

**Özet:** (1) + (2) + (3) "üst üste ve toplu gönderim" riskini kapatır; (4)+(5)+(6) kalite puanını korur.
Parametreler (90 sn, 6/gün, 40/saat, 2/hafta) **öneridir** — owner onaylayınca ayara bağlanır.

---

## 2) Senin yapacakların — Meta kurulumu (kritik yol)

Bunlar yalnızca senin yapabileceğin işletme adımları:

1. **Meta Business Manager** hesabı + **WhatsApp Business Account (WABA)** oluştur
   (business.facebook.com → WhatsApp Manager).
2. **WhatsApp'a özel bir telefon numarası** ayır. ⚠️ Bu numara **kişisel/normal WhatsApp'ta KAYITLI
   OLMAMALI** — yoksa o hesap WhatsApp Business API'ye taşınır ve normal WhatsApp'ta kullanılamaz.
   Stüdyonun ayrı bir hattı ideal.
3. **İşletme doğrulaması** (Meta business verification) — belge ister, birkaç gün sürebilir.
4. **Şablonları onaya gönder** (Bölüm 4) — WhatsApp Manager → Message Templates. Her biri ayrı ayrı
   incelenir (dakikalar–saatler). Kategori: **UTILITY**, Dil: **Türkçe (tr)**.
5. **Kimlik bilgilerini bana Secret Manager üzerinden ilet** — ⚠️ **sohbete YAPIŞTIRMA** (PAYTR'daki
   gibi; token bir sırdır). Şunlar gerekli:
   - `WHATSAPP_PHONE_NUMBER_ID` (Phone Number ID)
   - `WHATSAPP_ACCESS_TOKEN` (**kalıcı** System User token — geçici 24 saatlik olan değil)
   - (opsiyonel) WABA ID — kayıt/denetim için

Secret'ları şu komutla (sen çalıştırırsın, değer terminale girer, sohbete gelmez):
```
firebase apphosting:secrets:set WHATSAPP_ACCESS_TOKEN --project studio-yonetim-prod
# Phone Number ID sır değil; istersen ayar/ortam değişkeni olarak da tutulabilir.
```

---

## 3) Bende hazır olan / son wiring (secret gelince)

Kod tarafında **tek eksik**, secret'lar Secret Manager'da oluştuktan SONRA `apps/functions/src/shared/
region.ts`'teki `WHATSAPP_SECRETS = []`'e `'WHATSAPP_ACCESS_TOKEN'` (ve gerekiyorsa phone id) eklemek +
`providerConfig`'e Meta config'i beslemek. **Şimdi eklemem deploy'u 404 ile kırar** (var olmayan
secret'a bağlanılamaz), o yüzden bilerek en sona bırakıldı. Secret'lar hazır olduğunda:
1. `WHATSAPP_SECRETS`'e token'ı ekle, `notificationRetry` + `onEventCreated`'a bağla.
2. `providerConfig`'te `WHATSAPP_PHONE_NUMBER_ID` + `WHATSAPP_ACCESS_TOKEN` okununca transport gerçek olur.
3. Ayarlar › Ödeme & Bildirim'de WhatsApp kanalını aç.
4. Bir test üyesinde WhatsApp opt-in aç, bir rezervasyon yap → gerçek mesajın düştüğünü izlerim.

---

## 4) Meta'ya göndereceğin şablonlar (17 adet)

Her şablonu WhatsApp Manager'da **tam bu adla**, kategori **UTILITY**, dil **Türkçe**, gövdesi aşağıdaki
gibi (`{{1}}`, `{{2}}` … sıralı değişkenler) kaydet. Ad ve sıra kodun beklediğiyle **birebir** olmalı
(`META_TEMPLATE`). ⭐ = WhatsApp'a en uygun (yüksek değer / zaman-hassas).

| # | Şablon adı | ⭐ | Değişkenler (sırayla) | Örnek gövde |
|---|---|---|---|---|
| 1 | `booking_confirmed_tr` | ⭐ | {{1}} ad, {{2}} ders, {{3}} zaman | Merhaba {{1}}, {{3}} tarihindeki {{2}} dersiniz için rezervasyonunuz oluşturuldu. |
| 2 | `booking_cancelled_tr` |  | {{1}} ad, {{2}} ders, {{3}} zaman | Merhaba {{1}}, {{3}} tarihindeki {{2}} dersi rezervasyonunuz iptal edildi. |
| 3 | `booking_moved_tr` | ⭐ | {{1}} ad, {{2}} eski, {{3}} yeni | Merhaba {{1}}, dersiniz {{2}} tarihinden {{3}} tarihine taşındı. |
| 4 | `session_cancelled_tr` | ⭐ | {{1}} ad, {{2}} ders, {{3}} zaman | Merhaba {{1}}, {{3}} tarihindeki {{2}} dersi iptal edildi. Kredileriniz iade edildi. |
| 5 | `waitlist_promoted_tr` | ⭐ | {{1}} ad, {{2}} ders, {{3}} zaman | Merhaba {{1}}, {{3}} tarihindeki {{2}} dersinde yeriniz açıldı, rezervasyonunuz onaylandı. |
| 6 | `closure_applied_tr` | ⭐ | {{1}} ad, {{2}} sebep, {{3}} adet | Merhaba {{1}}, {{2}} nedeniyle {{3}} dersiniz iptal edildi. Kredileriniz iade edildi. |
| 7 | `package_created_tr` |  | {{1}} ad, {{2}} paket | Merhaba {{1}}, {{2}} paketiniz tanımlandı. İyi antrenmanlar! |
| 8 | `package_expiring_tr` | ⭐ | {{1}} ad, {{2}} paket, {{3}} gün | Merhaba {{1}}, {{2}} üyeliğinizin bitmesine {{3}} gün kaldı. |
| 9 | `package_expired_tr` |  | {{1}} ad, {{2}} paket | Merhaba {{1}}, {{2}} üyeliğinizin süresi doldu. |
| 10 | `session_rescheduled_tr` | ⭐ | {{1}} ad, {{2}} ders, {{3}} eski, {{4}} yeni | Merhaba {{1}}, {{2}} dersi {{3}} tarihinden {{4}} tarihine ertelendi. |
| 11 | `credits_low_tr` |  | {{1}} ad, {{2}} kalan | Merhaba {{1}}, kredi bakiyeniz azaldı: {{2}} kredi kaldı. |
| 12 | `credits_exhausted_tr` |  | {{1}} ad | Merhaba {{1}}, kredileriniz tükendi. Yeni paket için bize ulaşabilirsiniz. |
| 13 | `payment_received_tr` |  | {{1}} ad, {{2}} tutar | Merhaba {{1}}, {{2}} tutarındaki ödemeniz alındı. Teşekkürler! |
| 14 | `balance_reminder_tr` | ⭐ | {{1}} ad, {{2}} tutar | Merhaba {{1}}, {{2}} tutarında ödenmemiş bakiyeniz bulunuyor. |
| 15 | `instalment_due_tr` | ⭐ | {{1}} ad, {{2}} tutar, {{3}} tarih | Merhaba {{1}}, {{2}} tutarındaki taksitinizin son ödeme tarihi {{3}}. |
| 16 | `portal_invite_tr` |  | {{1}} ad, {{2}} bağlantı | Merhaba {{1}}, üye portalınıza şu bağlantıdan giriş yapabilirsiniz: {{2}} |
| 17 | `wallet_topup_tr` |  | {{1}} ad, {{2}} tutar, {{3}} bakiye | Merhaba {{1}}, cüzdanınıza {{2}} yüklendi. Güncel bakiye: {{3}}. |

> İpucu: Önce **⭐'lı olanları** onaya gönder (asıl operasyonel değer onlarda). Meta bir şablonu
> reddederse gövdesini biraz sadeleştir (emoji/promosyon dili azalt) ve tekrar gönder.

---

## 5) Özet — kim ne yapacak

- **Sen:** Meta Business + WABA + özel numara + işletme doğrulaması + 17 şablonu onaya gönder +
  kimlik bilgilerini Secret Manager'a koy. (A) opt-in ve (B) hangi olaylar kararlarını bana söyle.
- **Ben:** Bu doküman + şablon içerikleri hazır. Kararlarını verince olay-bazlı WhatsApp izin listesini
  (B) koda eklerim. Secret'lar gelince son wiring'i yapıp gerçek gönderimi seninle test ederim.
