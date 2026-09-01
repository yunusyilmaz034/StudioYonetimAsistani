# Turnike — donanım spesifikasyonu v1

> **Bu belge bir alışveriş listesi değil, bir dondurma işlemidir.** Buradaki her satır, bir akşam
> masada öğrenilmiş bir şeyin karşılığı. Bir sonraki kurulum bu listeden yapılır; listede olmayan bir
> parça denenecekse, denemesi **masada** yapılır, kapıda değil.
>
> Owner, 2026-09-01: *"habire ürün değiştiriyoruz, bir standart donanım yapamadık; başka yerlere
> kursak patlayacağız."* Doğru itiraz. Birinci ünitenin işi tam olarak buydu — BOM'u keşfetmek.
> Hata, keşfedip dondurmadan ikinciye gitmek olurdu.

---

## 1 · Parça listesi (v1, donduruldu)

| Parça | Neden bu | Neden başkası değil |
|---|---|---|
| **ESP32-S3 DevKitC-1 (N16R8)** | İki ekranı tek kart sürüyor | İki ayrı kart = iki WiFi, iki besleme, iki arıza |
| **3.2" ILI9341 SPI ekran ×2**, dokunmatiksiz, **3.3 V** | Turnike gövdesine sığıyor, QR okunaklı | Regülatörü yok — **5 V yakar** |
| **2 kanallı 5 V röle modülü** (optokuplörlü, jumper'lı) | Turnikenin iki yönü ayrı kuru kontak ister | Tek kanal, iki yönü sürmez |
| **5 V 2 A adaptör + USB-C** | Kurulumun varsayılan beslemesi | — |
| **LM2596 buck çevirici** | Priz yoksa turnikenin 12 V çıkışından beslemek için | Yalnızca priz yoksa; varsayılan değil |
| **12 V aktif buzzer + sürücü** (röle modülü ya da NPN) | Salonda müzik varken duyulan tek çözüm | **3.3 V'luk modül yetmiyor** — ölçüldü |
| **Dupont dişi-dişi 20 cm + 30 cm** | ESP32 gövdenin ortasında, her ekrana ~24 cm | Breadboard titreşimde gevşer |
| **Vidalı klemens** (3V3 dağıtımı) | Kartta iki `3V3` var, dört tüketici | — |

**Turnike:** Perkotek S310. Menü: `F01=5` · `F02=0` · `F03=0` · **`F04=0`**.

---

## 2 · Pin haritası (değiştirilmez)

```
SCK   12        MOSI  11        DC   13        RST  8  (ortak hat)
CS    10 giriş  ·  9 çıkış      LED  18        BUZZER 16
RÖLE  IN1 → 5 (giriş kolu)   ·   IN2 → 4 (çıkış kolu)
```

**Yasak pinler ve sebepleri — üçü de ölçülmüş, tahmin değil:**

| Pin | Ne oldu |
|---|---|
| **`GPIO 6`** | Çıkış ekranının `CS`'i olarak denendi, tek ekran açıldı · HIGH sürülünce **iki ekran birden söndü** (2/2) · buzzer'ı 250 ms'de hiç öttüremedi. Üç bağımsız arıza, sebep bilinmiyor. **Kullanılmaz.** |
| **`GPIO 21`** | Bu kartta şerit **lehimsiz** geldi. Pin seçimi pinout'a değil **karta bakarak** yapılır. |
| **Boşta bırakılan buzzer pini** | `pinMode(INPUT)` — takılı buzzer üzerinden 3.3 V rayına akım yolu açıyor, ekranlar başlamıyor. **Buzzer pini her zaman sürülür** (`HIGH` = sessiz). |

---

## 3 · Bağlantı kuralları

**Röle kartı — iki `VCC` var, karışan hep bu:**
```
4'lü sıra (sinyal)              3'lü sıra (bobin)
  VCC → ESP32 3V3   ZORUNLU       JD-VCC → +5 V
  GND → ESP32 GND   ZORUNLU       GND    → 5 V'un GND'si
  IN1 → GPIO 5                    VCC    → BOŞ
  IN2 → GPIO 4                    JUMPER KAPAĞI ÇIKARIK
```
4'lü sıranın `VCC`/`GND`'si bağlanmazsa röle **hiç çekmez**: o uçlar optokuplörün giriş tarafını
besliyor. Jumper takılı kalırsa `IN` pinleri 5 V'ta oturur, ESP32 açılmaz ve kontrolcü ölünce
**iki röle birden çeker** — duvarda "kapı açık kalır" demek.

**Turnike anakartındaki terminaller** (1 Eylül, gövde açılıp etiketten okundu — artık tahmin değil):

```
OP-L solenoid   12V Adapter input   [OP-L · COM · OP-R]   [12V · GND]
                                     Access Control Input  12V Output
OP-L test key   OP-R test key       Drop arm solenoid   LED indicator   OP-R solenoid
```

**Kontak tarafı:** röle kanal 1 → `Access Control Input`'ta `COM`+`OP-R`, kanal 2 → `COM`+`OP-L`,
**`NO`** ucu. **Turnikenin GND'si ESP32'ye bağlanmaz** — kuru kontağın yalıtımını bozan tek şey odur.

**`12V Output` mevcut.** LM2596 buradan beslenebilir, ayrı priz gerekmez — ama kaç mA verdiği hâlâ
ölçülmedi (bkz. §4/1).

⚠️ **`OP-R`/`OP-L` yönü tahmin edilmez** — şemadaki oklar butonlardaki yazıyla çelişiyor. Ama kabloyla
uğraşmaya da gerek yok: **anakartta `OP-L test key` ve `OP-R test key` butonları var.** Basılır,
hangi kolun döndüğüne bakılır, yazılır. ESP takılmadan, kablo bağlanmadan yapılabilir — ve kurulumun
en erken adımı olmalı, çünkü yanlış eşleme sessizce yaşar: girişte okutan üye çıkış kolunu açar,
kimse fark etmez, doluluk ters döner.

**Ekran:** `VCC→3V3 · GND→GND · CS→10/9 · RESET→8 · DC→13 · SDI→11 · SCK→12 · LED→18`.
`SDO` ve `T-*` boş. İkinci ekran nesnesi `RST` almaz (`-1`): hat ortak, ikinci `begin()` birinciyi
siler.

---

## 4 · Kurulum ve doğrulama sırası

Her adım bir öncekini varsayar. Atlanan adım, sonrakinin cevabını da şüpheli yapar.

1. Priz var mı? **Varsa** 5 V adaptör. **Yoksa** LM2596 — çıkışı *hiçbir şey bağlı değilken* 5.00 V'a
   ayarlanır, sonra bağlanır.
2. ESP32 tek başına besle → açılıyor mu.
3. Ekranlar: `-D TESHIS` ile her ekran **kendi adını** yazar. Hangi ekranın hangi kapı olduğu böyle
   öğrenilir, kablo değiştirerek değil.
4. Röle: panelden *Giriş kapısını aç* → `DS1` yanmalı, klik gelmeli.
   · DS1 yanmıyor → 4'lü sıranın `VCC`/`GND`'si yok. · DS1 yanıyor klik yok → `JD-VCC`'deki 5 V.
5. **`OP-R test key` / `OP-L test key`** butonlarına basılır, dönen kollar yazılır. (Bu adım aslında
   1'den de önce yapılabilir: ne ESP ne kablo gerekiyor.)
6. Üye geçişi **iki yoldan**: mobil uygulama **ve** tarayıcı. İkincisi üyelerin çoğunun yolu.
7. Paketi bitmiş üyeyle ret testi: kol dönmemeli, ekranda "Lütfen resepsiyona uğrayın".

**Beyaz ekran iki ayrı arızanın aynı görüntüsüdür** — `qrCiz` ekranı önce beyaza boyuyor. Ayıran tek
adım `-D TESHIS`. İlk hamle her zaman o olmalı.

---

## 5 · İkinci stüdyodan ÖNCE yapılması gerekenler

Bunlar parça meselesi değil, ve bu hâliyle her kurulum bir gece yer:

1. **WiFi, cihazın üstünden girilmeli.** Bugün SSID/şifre `secrets.h`e yazılıp flash'lanıyor — yani
   her kurulum bir Mac ve bir yazılımcı istiyor. Gereken: kart kendi erişim noktasını açsın, telefondan
   ağ seçilsin. Firmware bugün **iki ağı** deniyor; bu bir yama, çözüm değil.
2. **Cihaz kimliği panelden üretilmeli.** İlk iki cihaz elle oluşturuldu; panelde cihaz ekleme ekranı
   yok. Yeni bir kapı, yeni bir sır ve yeni bir `side` demek.
3. **Kablo düzeni sabitlenmeli.** Dupont + klemens bir prototip çözümü. Vidalı taşıyıcı ya da küçük
   bir kart, titreşimli bir gövdede tek kalıcı cevap.

Üçü de **Faz 2**. Bugün yazılmayacak — ama ikinci kapı takılmadan önce yazılacak, çünkü ikinci kapı
takıldığı anda bunlar birer arıza olarak geri gelir.

---

## 6 · Firmware

Kartta çalıştığı doğrulanmış sürüm: **`turnike-v1.0`** etiketi.

Değişiklik yapılacaksa: **önce bu etikete dön, üstüne tek değişiklik koy, karta at, ekranlara bak.**
Bu kartta "ekranlarla ilgisi olmayan değişiklik" diye bir şey yok — bir akşam tam olarak bunu öğretti
(`docs/OWNER-RULES.md`, OR-60 · OR-61).

Yükleme, tek komut, tek kart:

```
cd apps/turnstile && ~/Library/Python/3.9/bin/pio run -t upload
```
