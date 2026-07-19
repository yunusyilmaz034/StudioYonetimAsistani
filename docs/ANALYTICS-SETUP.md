# Analytics & Crash Reporting — kurulum

Owner-facing. Ürün analitiği (GA4) ve çökme raporlama (Crashlytics) iki yüzeyde çalışır: **web**
(panel + üye portalı) ve **mobil** (üye uygulaması). Kod her iki tarafta da hazır ve akışlar
işaretli; aşağıdaki adımlar bunları **etkinleştirir**. Etkinleştirene kadar analytics sessiz bir
no-op'tur — hiçbir akışı bozmaz.

Neyi ölçüyoruz (owner listesi): **login**, **ödeme** (başlatma + dönüş), **QR** (üretim + tarama/
check-in), **görsel yükleme** (medya, üye belgesi, avatar), **cüzdan** (yükleme + satın alma),
**kamera** açılan yerler, ve üye QR'ında **konum** (yalnızca web portalı, rızalı — aşağıya bakın).

> **Gizlilik kuralı (#6, her iki tarafta da geçerli):** Analytics'e asla isim/telefon/e-posta/serbest
> metin gönderilmez — yalnızca id'ler ve enum'lar (studioId, rol, productId, tutar). Konum ise event
> log'una **hiç** girmez; ayrı, silinebilir bir koleksiyonda tutulur (KVKK "unutulma hakkı").

---

## 1) Web — GA4 (birkaç dakika, kod değişikliği yok)

Web tarafı Firebase Analytics (GA4) kullanır. Tek gereken bir ölçüm kimliği:

1. **Firebase Console → Project Settings → Integrations → Google Analytics** açık olsun (değilse
   "Enable Google Analytics").
2. **Project Settings → General → Your apps → Web app → SDK setup** altından `measurementId`
   değerini kopyalayın (biçim: `G-XXXXXXXXXX`).
3. **App Hosting** ortam değişkenlerine ekleyin:
   ```
   NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID=G-XXXXXXXXXX
   ```
4. Yeni bir deploy sonrası aktif olur. Doğrulama: Firebase Console → Analytics → **Realtime** —
   panele/portala girince `login_success`, `qr_scanned` gibi olaylar birkaç saniye içinde düşer.

`measurementId` **gizli değildir** (config'in geri kalanı gibi bir tanımlayıcı). Yoksa analytics
otomatik olarak kapalıdır; dev ve testlerde de kapalıdır.

### Konum (üye QR'ı, rızalı)
Kod hazır ve KVKK-uyumlu: üye portalında QR ekranındaki **"Konumumu paylaşmayı kabul ediyorum"**
kutusu + tarayıcı izni ile, yaklaşık (≈1 km) konum `studios/{sid}/checkinLocations` koleksiyonuna
yazılır (event **değil**, silinebilir). Ek kurulum gerekmez. Yalnızca:
```
pnpm deploy:rules
```
(checkinLocations'ı server-only yapan kural için — üye kendi konumunu asla doğrudan yazamaz.)

---

## 2) Mobil — `@react-native-firebase` (native, EAS build gerekir)

React Native, web'in `firebase/analytics`'ini kullanamaz (DOM ister). Gerçek mobil Analytics +
Crashlytics **native** modüller ister. Kod tarafı seam olarak hazır: `apps/mobile/src/lib/analytics.ts`
şu an no-op, ve tüm ekranlar zaten `track(...)` çağırıyor. Etkinleştirmek için **yalnızca o dosyanın
gövdesi** değişir — çağrı noktaları aynı kalır.

Adımlar (bir kez, native build ile):

1. Firebase Console'dan uygulama config dosyalarını indirin ve `apps/mobile` köküne koyun:
   - `google-services.json` (Android)
   - `GoogleService-Info.plist` (iOS)
   > Bunlar gizli değil ama repoya commit etmeyin — `.gitignore`'da tutup EAS secret / yerel dosya
   > olarak sağlayın.
2. Paketleri ekleyin:
   ```
   cd apps/mobile
   npx expo install @react-native-firebase/app @react-native-firebase/analytics @react-native-firebase/crashlytics
   ```
3. `app.json` → `expo.plugins` altına ekleyin:
   ```json
   ["@react-native-firebase/app", "@react-native-firebase/crashlytics"]
   ```
   ve iOS için `expo.ios.googleServicesFile` / Android için `expo.android.googleServicesFile`
   yollarını verin.
4. `src/lib/analytics.ts` içindeki `TODO(mobile-analytics)` yorumlarını gerçek çağrılarla doldurun
   (`analytics().logEvent`, `crashlytics().recordError`, `setUserProperties`).
5. Yeni bir **EAS/dev build** alın (Expo Go native modülleri yükleyemez):
   ```
   eas build --profile development --platform all
   ```
6. Doğrulama: Firebase Console → Crashlytics (test için uygulamada bir crash tetikleyin) ve
   Analytics → Realtime.

Bu adımlar tamamlanana kadar mobil uygulama sorunsuz çalışır; sadece analytics/crash verisi düşmez.
