# Handover — where this project actually is

**Read this first in a new session.** It is the only document that answers "what is live, what is
half-done, and what is somebody waiting on". Everything else in `docs/` explains the system; this
explains the moment.

Keep it current the way the code is kept current: when the state changes, this changes in the same
commit. A handover document that lags is worse than none, because it is believed.

_Last true as of: **2026-08-31**._

## 🌙 31 Ağustos 2026 — uzun bir gün, on beş deploy

Panel canlıda **`build-2026-08-31-015`** (commit `8e4e263`, trafiğin %100'ü — OR-17: tek dürüst
kanıt Cloud Run trafik dağılımı). **Cloud Functions bugün yeniden dağıtıldı** (`onEventCreated`
16:11:57Z) — şablon bazında kanal susturma orada çalışıyor, panelde değil.

### Canlıya giden işler

| Alan | Ne oldu | Kural |
|---|---|---|
| **Dondurma** | İleri tarihe planlanabiliyor; hak aşımında zorunlu sebep + uyarı | [[OR-50]] |
| **Dondurma** | Süresi dolmuş paketin bitişi ileri alınınca paket **canlanıyor** (kredili paket reddedilir) | [[OR-52]] |
| **Turnike** | Canlı paketi olmayana kol dönmüyor — **çıkış hariç** | [[OR-53]] |
| **Stüdyodan** | Gönderim önizlemesi (kime ne gidecek), **durdurulabilir** gönderim, elle üye grupları, tıklanabilir kitle sayıları | [[OR-48]] · [[OR-51]] |
| **Stüdyodan** | Ekran yeniden tasarlandı: her kanal ayrı kutu + kaç kişiye ulaştığı, "Bildirim Gönder", üç adım, sabit özet | owner onaylı tasarım |
| **Bildirimler** | Şablon bazında kanal susturma; rezervasyon + iptal WhatsApp'ı **kapalı** | — |
| **Takvim** | Ay görünümünde başka ay geri çekildi, ay sınırı isimlendi, bugün çerçeveli | owner onaylı tasarım |
| **Eğitmen** | Kendi üye ekranı (`/trainees`) + Personel'de **davet linki** | [[OR-47]] · [[OR-49]] |
| **AI** | Fit Paket'ten hiç bahsetmiyor · müşteriye "hocam" demiyor · satış dışını 0533'e yönlendiriyor · telefon cevabı tek cümle · 16 Ders (2 aylık) satıyor | — |
| **Check-in** | Hata artık yutulmuyor: oturum/yetki/ağ ayrı ayrı söyleniyor ve konsola yazılıyor | [[OR-42]] hattı |

### Elle düzeltilen canlı kayıtlar

Üçü de **domain üzerinden**, sebebi olayla birlikte — konsoldan elle değil.

- **GÜLNARA YYILMAZ · HAYRİYE BAYRAM** — bitiş tarihi 7 Eylül'e alınmış ama paket `expired` kalmıştı;
  ikisi de aktife alındı (`tools/migration/revive-expired-with-future-date-2026-08.ts`).
- **ESRA TEPE** — 24 Ders satılmış, resepsiyon 8 Ders / 4.200 ₺ yazmıştı. Paket 24 Ders'e, süre
  29.11.2026'ya, tutar 11.000 ₺'ye çekildi; +16 kredi **telafi kaydıyla** eklendi (`granted`
  değiştirilmedi); yanlış ödeme ve satış iptal edilip doğrusu kuruldu. Kalan **23 ders**, borç yok.
  Havale olduğu için kasa etkilenmedi. (`tools/migration/fix-esra-24-ders-2026-08.ts`)

### 🚪 Panelden turnikeyi açmak (1 Eylül)

Owner: *"panelden resepsiyon açabilmeli çift yönlü olarak turnikeyi."*

Ortaya çıkan şey şuydu: `openTurnstileManually` Ağustos sonundan beri **olay yazıyor ve cihaza hiç
ulaşmıyordu**. Yani panelde bir "elle aç" kaydı vardı ve o kayıt hiçbir zaman bir kolun dönmesine
karşılık gelmiyordu. Kimse fark etmemişti çünkü kimse denememişti.

Kurulan yol, ret bildirimiyle aynı desen: `turnstileCommands/{deviceId}` altında cihaz başına **tek**
komut, **20 saniye** ömürlü, cihaz okuduğu anda silinir. Kalıcı kuyruk yok — vazgeçilmiş bir açma
on dakika sonra kapıyı kimsenin beklemediği bir anda döndürmesin.

Düğmeler **Giriş / Çıkış ekranında**, iki kapı iki ayrı düğme (tek düğme resepsiyona hangi kolun
döneceğini tahmin ettirirdi). Ekranda kimse karşılanmaz — kimin geçtiğini bilmiyoruz, ve bilmediğimiz
şeyi yazmayız (#11). Kimin **açtığı** ve sebebi olayda duruyor.

Turnikesi olmayan stüdyoda bölüm hiç görünmez.

### 📵 20 saattir çalan alarm — ve alarmın kendisinin sesi çıkmıyordu (1 Eylül akşamı)

Google Cloud her saat başı e-posta gönderiyordu: `health: ai_not_replying`, 20 saattir. Ölçüldü:
**AI çalışıyor** (en son 12 dakika önce cevap vermişti). Alarm tek bir sohbet yüzünden bağırıyordu ve
o sohbet gerçekten cevapsızdı — **Tuğba Şardan, 21 saat.**

**Nasıl oldu:**
```
17:23  Işıl telefondan elle cevap yazdı        → sohbet 'human'a geçti        (doğru)
18:20  Müşteri: "Fitness için bilgi alabilir miyim"
       webhook: status=human → AI susuyor, resepsiyona işaret koyuyor        (doğru)
       …sonra sohbet 'ai'ya geri verildi ve İŞARET, SORU CEVAPLANMADAN temizlendi
```
AI yalnızca **yeni mesaj geldiğinde** konuşuyor. Yeni mesaj hiç gelmediği için soru sonsuza kadar
orada kaldı. Kaybolan şey cevap değil, **cevabın gerektiğini söyleyen tek işaretti.**

**Düzeltme:** son söz müşterideyse "gördüm" ve "AI'ya ver" o işareti artık kapatmıyor
(`attentionReason: 'unanswered'`), ve panel sebebini söylüyor. Kapatan tek şey cevabın kendisi.
*Kim ilgileniyor* ile *ilgilenilmesi gerekiyor mu* ayrı sorulardır; ikisini tek bayrağa bağlamak,
birincisini değiştirmeyi ikincisini silmek yaptı.

**AI'ın devir-teslimde kendiliğinden cevap yazması bilerek YAPILMADI:** insanın yarım bıraktığı bir
konuşmaya AI'ın söze girmesi, sessizlikten kötü bir şey söyleyebilir. Sistem bildirir, insan karar
verir.

**Ve sonra alarm susmadı (aynı akşam, 21:20).** Sırlar bağlanınca uyarı ilk kez ulaştı — ama 15
dakikada bir ulaşmaya devam etti, üstelik iki ayrı Google politikasından iki kopya hâlinde. İki hata
üst üste binmişti:

· `ai_not_replying`, **37 gün** önce cevapsız kalmış bir mesajı da sayıyordu. Oysa o, asistanın şu an
  bozuk olduğunu göstermez. Kontrole **üst sınır** kondu: 10 dakika – 6 saat. Altı saatten eskisi bir
  arıza değil, düşmüş bir lead'dir ve yeri panodaki günlük liste — orada adı var ve tek tıkla açılıyor.
· Her bulgu, önemi ne olursa olsun `ERROR` yazılıyordu; Google'da `ERROR`'a bakan **ayrı** bir
  politika var, yani tek bulgu iki e-posta üretiyordu. Artık `critical` → ERROR, gerisi → WARNING.

**On beş dakikada bir çalan alarm, susturulan alarmdır** — ve susturulduğu andan sonra yoktur.
Ölçüldü: değişiklikten sonra alarm penceresinde 0 kayıt, Tuğba panoda iş olarak duruyor.

### 🔇 Uyaramayan uyarı sistemi (1 Eylül akşamı)

Aynı loglarda duran iki satır:
```
e-mail transport is the CONSOLE — no message will leave the building
WhatsApp transport is the MOCK   — no message will leave the building
```
`healthCheck` fonksiyonu kritik bulguyu owner'a `notify()` ile ulaştırıyor — ama **`secrets`
bağlanmamıştı**, o yüzden e-posta console'a, WhatsApp mock'a düşüyordu. Komşuları
(`infrastructureWatch`, `notificationRetry`) bağlamıştı; bu satır atlanmış.

Yani sistem sorunu **görüyor ve kimseye söyleyemiyordu.** 20 saatlik alarmı fark etmemizin tek
sebebi Google'ın kendi uyarı e-postasıydı — bizim yolumuz değil, altımızdaki bulutun yolu.
**Uyaramayan bir uyarı sistemi yoktur.** Tek satır: `secrets: [...NOTIFICATION_SECRETS]`.

### 🚦 Turnike, canlıya çıkmadan önce ölçülenler (1 Eylül)

Owner: *"amacımız turnike sistemini tamamen bitirmek, akşam da montajını yapalım, aktife canlıya
alalım."* Montajdan önce üç şey ölçüldü ve ikisi eksikti.

**1 · Kapıyı yalnızca mobil uygulama açabiliyordu.** 177 aktif üyenin **138'i** portalı açmış,
mobil uygulaması olan **58**. Yani turnike bu hâliyle takılsaydı üç üyeden ikisi kapıda kalırdı.
Düzeltildi: tarayıcıdaki portal okuyucusu artık altı haneli turnike kodunu da tanıyor — mobildeki
kuralın aynısı, aynı yerde ([[OR-59]]).

**2 · Panelden açma cihaza hiç ulaşmıyordu** — yukarıda.

**3 · Giriş cihazının adı `polis`'ti** (kurulum gecesinden kalma test adı) ve o ad panelde
resepsiyona görünüyordu. `Giriş turnikesi` yapıldı
(`tools/migration/rename-turnstile-device-2026-09.ts`).

Ayrıca panelde artık **çevrimdışı** kapı düğmesi basılamıyor: cihaz kodunu ~25 saniyede bir tazeliyor,
90 saniye sessizlik arızadır. Bu satır olmasa resepsiyon ölü bir kapıya basıp düğmeyi bozuk sanırdı.

### ⏱ Mesai — personelin giriş çıkışı (1 Eylül)

`/mesai`: tek düğme, *Mesaiye başla* / *Mesaiyi bitir*. Günün listesini yalnızca owner görür.

Turnikeden **ayrı** tutuldu ve sebebi [[OR-58]]'de: personel gün içinde defalarca geçiyor, her geçişi
mesai saymak "saat kaçta geldi"yi cevapsız bırakırdı. Yeni olaylar: `staff.shift_started`,
`staff.shift_ended` (PII yok — opak kimlik ve dakika).

RFID kart okuyucu sipariş edilecek ama **beklenmiyor**: geldiğinde personel geçişi karta bağlanabilir,
mesai kaydı yine ayrı kalır.

**ÇÖZÜLDÜ — takılı bir buzzer varken pin boşta bırakılmaz (1 Eylül).**

Buzzer'ı `GPIO 6`dan `16`ya alınca ses geldi, **iki ekran birden gitti.** Owner haklıydı: *"bir şey
yapmadık, birden gitti"* — kabloya dokunulmamıştı, suçlu koddu.

Bisect tablosu (kontrol iki kez tekrarlandı, yani sonuç şansa bağlı değil):

| Sürüm | Ekranlar |
|---|---|
| `GPIO 6`, boşta (INPUT) | çalışıyor — 4/4 |
| `GPIO 6`, HIGH sürülüyor | bozuk — 2/2 |
| `GPIO 16`, boşta (INPUT) | bozuk — 3/3 |
| **`GPIO 16`, HIGH'ta tutuluyor** | **çalışıyor** |

**Sebep:** aktif-LOW modülde buzzer'ın bir ucu 3.3 V'ta, öbür ucu bu pinde. Pini `INPUT` yapmak onu
boşta bırakmak, ve boşta bırakmak açılıştaki iç pull-up'ı kapatmak demek. O anda buzzer kendi
üzerinden pine akım akıtıyor: 3.3 V rayı yükleniyor, pinin koruma diyotları sürülüyor. Ekranlar o
raydaki en ağır yük, başlatma dizisi bu yüzden tutmuyordu.

**Neden bu kadar uzun sürdü:** `pinMode(16, INPUT)` "hiçbir şey yapamaz" bir satır. O cümleye
güvendim, ve o yüzden önce pini, sonra donanımı, sonra teması suçladım. **Takılı bir buzzer varken o
satır bir şey yapar** — ve `GPIO 6`da yapmamasının sebebi, oraya bağlı bir şey olmamasıydı. Yani
"imkânsız" olan belirti değil, devre hakkındaki modelimdi.

**Doğru hâl:** boşta bırakma; `HIGH`'ta tut. Buzzer'ın iki ucu da 3.3 V'ta olur, akım sıfır. `bip()`
artık pini hiç serbest bırakmıyor, yalnızca LOW/HIGH arasında sürüyor.

`GPIO 6` yine de kullanılmıyor: HIGH sürülünce ekranları bağımsız olarak bozdu (2/2) ve buzzer'ı
250 ms'de hiç öttüremedi. O pinin kendi ayrı derdi var, ve sebebini hâlâ bilmiyoruz.

**DONANIM SPESİFİKASYONU DONDURULDU:** [`docs/TURNSTILE-HARDWARE.md`](TURNSTILE-HARDWARE.md).
Parça listesi, pin haritası, yasak pinler ve kurulum sırası tek yerde. **İkinci stüdyoya bu belgeden
kurulur.** Owner'ın itirazı yerindeydi: *"habire ürün değiştiriyoruz, bir standart donanım yapamadık."*
Birinci ünitenin işi BOM'u keşfetmekti; hata, keşfedip dondurmadan ikinciye gitmek olurdu.

Belgenin §5'i asıl uyarı: **ikinci kapı takılmadan önce WiFi'nin cihaz üstünden girilmesi ve cihaz
kimliğinin panelden üretilmesi gerekiyor.** Bugün ikisi de elle yapılıyor, yani her kurulum bir Mac ve
bir yazılımcı istiyor. Parça meselesi değil, ve Faz 2.

**KARTTAKİ SÜRÜM: `turnike-v1.0` (owner: *"bu sürüm çalışan sürüm, bunu kilitle"*).**

Etiketlenen commit, ESP32'ye atılmış ve tek tek doğrulanmış hâl: iki ekranda QR · röle darbesi ·
geçiş kaydı ve karşılama · çıkış yönü · buzzer (`GPIO 16`, 250 ms, duyulur).

Firmware'e bir daha dokunulacaksa **önce bu etikete dön**, üstüne tek değişiklik koy, ve karta atıp
ekranlara bak. Bu akşam öğrenilen şey şu: bu kartta "ekranlarla ilgisi olmayan" bir değişiklik yoktur.

**Buzzer `GPIO 16`da, 250 ms, çalışıyor (1 Eylül).** `GPIO 6` bu kartta **üç kez** tökezledi: çıkış
ekranının `CS`'i olarak denenip elenmişti · HIGH sürülünce iki ekranı birden söndürdü · buzzer'ı
250 ms LOW'da hiç öttüremedi (sürekli LOW'da yalnızca zar zor bir uğultu — akımı düzgün çekemiyor).
Üç bağımsız arıza, tek pin. Sebebini bilmiyoruz; bildiğimiz, uzak durmak. `21` denendi ama o şerit
bu kartta **lehimsiz** geldi — pin seçimi teoriyle değil karta bakarak yapılıyor, çünkü lehimsiz bir
pin teması tesadüfe bırakır ve bu kart bir akşamını tam olarak buna yedirmişti. `16` ilk denemede
öttü. Ses kısık kaldı: **DEBT-038**.

**`GPIO 6` HIGH SÜRÜLMEZ — ekranları bozdu (1 Eylül).**

Buzzer aktif-LOW çıkınca bariz çözüm göründü: sussun diye pini HIGH tut. **İki ekran birden beyaz
kaldı.** Sebebini bilmiyoruz ve uydurmuyoruz; bildiğimiz, bu pinin bu kartta ikinci kez ekranları
bozduğu — bir kez çıkış ekranının `CS`'i olarak denenip elenmişti.

Teşhis, kabloya hiç dokunmadan yapıldı ve sırası önemliydi:
1. `-D TESHIS` (QR yerine düz yazı) → hâlâ beyaz. Demek ki suçlu QR yolu değil, panel hiç
   başlamıyor. Bu, "beyaz" ile "yarım çizim"i ayıran tek adım: `qrCiz` ekranı **önce beyaza**
   boyuyor, yani beyaz iki farklı arızanın aynı görüntüsü.
2. `-D BUZZERSIZ` (pine hiç dokunma) → **yazılar geldi.** Şüpheli bayrakla ayrıldı, tornavidayla
   değil — ekranlar silikonlanmıştı, sökmek saatler yerdi.

**Çözüm kabloyu taşımak değil, pini hiç sürmemek.** Boşta (INPUT) bırakılınca buzzer zaten sessiz,
bu da aynı akşam ölçüldü. `bip()` artık `darbe()`nin röle için yaptığını yapıyor: normalde yüksek
empedans, yalnızca öterken LOW. `HIGH` hiçbir yerde yazmıyor ve o satırın yokluğu kuralın kendisi.

**Buzzer modülü AKTİF-LOW çıktı (1 Eylül, montajda).** Takılınca sürekli zayıf bir uğultu verdi:
modülde buzzer `VCC` ile `S` arasında duruyor, yani bizim "sessiz" dediğimiz seviye onun "öt"
seviyesiymiş. Teşhis `S`'i pinden çekmekle kondu — ses kesildi, demek ki pini süren bizdik.
`BUZZER_TERS = true` ve polarite **tek yerde**: sus ve öt ayrı ayrı çevrilseydi biri unutulur, kutu
ya hiç ötmez ya hiç susmazdı. Ayrıca buzzer artık `setup()`'ın **ilk** satırında susturuluyor —
`pinMode` çağrılana kadar pin boşta ve boşta duran pin ötüyor demek.

**İki ağ, tek kart (1 Eylül).** Kart evde kuruldu, turnike dükkânda. Tek ağ yazılıyken kutu montaj
gecesi hiçbir şey çizmez, "Baglanti yok" der ve 3 bip öter — ve düzeltmek Mac'i, kabloyu ve flash'ı
oraya taşımak demektir. `secrets.h` artık ikinci bir ağ kabul ediyor (`WIFI_SSID2`/`WIFI_PASS2`);
tanımlı değilse blok derlemeye girmiyor. Sırayla denenir, ağ başına 10 sn, ilk bağlanan kazanır.

### 🔧 Montaj gecesi — sırayla

0. **Dükkânın WiFi'si `secrets.h`e girildi mi?** Girilmediyse kart orada bağlanamaz. Bu, kapıya
   varmadan yapılacak tek şey.
1. ~~**Firmware'i at.**~~ 1 Eylül 16:40'ta atıldı. **TEK komut, tek kart:**
   `cd apps/turnstile && ~/Library/Python/3.9/bin/pio run -t upload`.
   `-e giris` / `-e cikis` diye bir şey YOK — `platformio.ini`de tek ortam var ve iki ekran tek
   ESP32'de yaşıyor. (`main.cpp`in tepesindeki o bayrakları anan yorum eskiydi, düzeltildi.)
   `pio` PATH'te değil, tam yolla çağrılıyor.
2. **Röle kablosu:** her ekran KENDİ kanalını sürüyor (giriş → In1/GPIO5, çıkış → In2/GPIO4).
   Ters bağlanırsa giriş kolu çıkıştan döner ve bu, kodda değil kabloda bir hatadır.
3. **Aç–kapa testi, panelden:** Check-in ekranındaki *Giriş kapısını aç* / *Çıkış kapısını aç*.
   Düğme sönükse cihaz çevrimdışıdır — önce WiFi, sonra kod.
4. **Üye testi, iki yoldan:** bir kez mobil uygulamayla, bir kez **tarayıcıdan** (portal → QR →
   kamera). İkisi de kolu döndürmeli; ikincisi üyelerin çoğunun kullanacağı yol.
5. **Ret testi:** paketi bitmiş bir üyeyle okut. Kol DÖNMEMELİ, ekran "Lütfen resepsiyona uğrayın"
   demeli, telefon uyarmalı.
6. **Resepsiyona anlatılacak üç cümle:** kapıyı panelden açabilirsin · paketi bitmiş üye geçemez,
   ekranda yazıyor · kendi mesaini `/mesai`den başlat ve bitir.

### ⚠️ Açık kalanlar (1 Eylül 19:00 itibarıyla, ölçülerek)

**İnsan işi — yazılım tarafında yapılacak bir şey yok:**

1. **Cevapsız iki WhatsApp sorusu.** İşaretleri panelde geri açıldı: **Tuğba Şardan** (21 saat,
   *"Fitness için bilgi alabilir miyim"*) ve 37 gün önce yazmış biri (*"endokrinoloji…"*).
   Cevabı insan yazacak — sistem bilerek otomatik cevap vermiyor.
2. **Eğitmen davet linkleri.** Işıl Hoca · Buse Hoca · Reyhan Hoca — **üçü de hâlâ hiç giriş
   yapmamış** (Auth'tan ölçüldü). Eski linkler bir saatte ölmüştü; yeni sistem **7 gün**. Personel
   ekranından yeniden üretilip yollanacak.
3. **Resepsiyona anlatılacak:** Stüdyodan gönderimi artık önce önizleme istiyor, başladıktan sonra
   durdurulabiliyor, ve sekmeyi kapatmak iptal ETMİYOR (154 kişiye mesaj bu yüzden gitti).
   Turnike için ayrıca: kapıyı panelden açabilirsin · paketi bitmiş üye geçemez, ekranda yazıyor ·
   kendi mesaini `/mesai`den başlat ve bitir.
4. **Eşleşmemiş 10 TL test ödemesi** — panelden sebep yazılarak iptal edilmesi öneriliyor.

**Bu akşam, dükkânda:**

5. **Turnike montajı.** Sıra: dükkânın WiFi'si `secrets.h`e → flash → `COM`–`OP-R` yön testi →
   `F01=5 F02=0 F03=0 F04=0` → panelden aç → üye geçişi (uygulama **ve** tarayıcı) → ret testi.
   Ayrıntı: [`TURNSTILE-HARDWARE.md`](TURNSTILE-HARDWARE.md) §4.
6. **Buzzer sesi kısık** (`DEBT-038`). 12 V buzzer + sürücü (röle modülü ya da NPN) sipariş edilecek;
   hangisi olacağı dükkânda prize ve 12 V çıkışına bakınca netleşir.

**İkinci stüdyodan önce — Faz 2, owner kararı bekliyor:**

7. WiFi cihazın üstünden girilebilmeli · cihaz kimliği panelden üretilebilmeli · kablo düzeni
   sabitlenmeli. Üçü de [`TURNSTILE-HARDWARE.md`](TURNSTILE-HARDWARE.md) §5'te. Bugünkü hâliyle her
   kurulum bir Mac ve bir yazılımcı istiyor.

**Kapananlar:** ~~turnike firmware'i~~ (atıldı, `turnike-v1.0`) · ~~GAMZE BAYKALDI'nın 7 günlük
boşluğu~~ (ölçüldü: 31.05→06.09 ve 06.09→05.12, boşluk yok) · ~~mobilden iş verme ölçümü~~ (bugün
gerek kalmadı).

### Bugün öğrenilen iki tuzak

- **Türkçe arama:** `/fit ?paket/i` deseni **"FİT PAKET" ile eşleşmez** — noktalı İ ASCII `i`'ye
  katlanmaz. Kartta üç satır bu yüzden gözden kaçtı ve "temizlendi" diye rapor edildi. Sessizce az
  sonuç döndüren arama, bulunacak bir şey olmadığı için az döndüren aramayla aynı görünür.
- **Ard arda iki push:** ilk build'in revizyonu ikinci commit'ten SONRA oluşabiliyor ve "commit'ten
  sonra ✓" testini geçiyor — içinde ikinci commit olmadan. Doğru kontrol, App Hosting build
  kayıtlarından **hangi commit'in hangi build'e girdiğine** bakmak.

---

🎬 **There is now a demo studio: `demo`, "Demo Stüdyo".** A broker asked to see the system and the
answer is no longer a screenshot. It lives in the SAME database as Işıl's, which is the whole reason
`tools/seed/demo-guard.ts` exists — see "The demo studio" below before touching any seeding script.
Login: `demo@retroasistan.com`, one-time password `AbQtq33SZ00O` (uid `zhnXax65cmUvm7gvRMGenr75oqL2`).

Panel live at **`build-2026-08-24-003`** (100% of traffic, verified the only way that counts —
Cloud Run's traffic split, OR-17, not the App Hosting listing). **Cloud Functions have NOT been
redeployed since 2026-08-09**; that question is asked every time `packages/core` changes and the
answer today is no — the week's core changes (`buildSession`, the session mapper, the TAMI adapter,
`PortalSession.cost`) are read by the web tier only.

**Mobile 1.7.0 is BUILDING as this is written** — iOS `1.7.0 (12)`, Android `1.7.0 (13)`, both
started 2026-08-25 ~01:20. On success they submit automatically: Android to Play **production at
100%**, iOS to App Store Connect. **iOS still needs "Submit for Review" clicked by hand** —
`eas submit` uploads, it does not release.

⚠️ **Three things are waiting on the owner, and none of them block anything else:**

1. **TAMI is finished but NOT switched on.** `settings/paymentProvider.provider` is still `paytr`.
   Everything else is verified against real money (see 2026-08-24 below). Flipping it in
   Ayarlar → Ödeme is the whole remaining step, and a small live sale should follow it — every test
   so far minted the token OUTSIDE our own flow, so the return path and the package grant have never
   run end to end.
2. **The FCM V1 key is not in EAS**, so Android tokens are issued but nothing is delivered.
   `eas credentials` has no scriptable path; the service account and key are prepared
   (`~/Downloads/eas-fcm-push-key.json`) and the four steps are in the 1.7.0 section below. **No new
   build is needed** — delivery starts the moment it lands.
3. **The dead man's switch is still not deployed.** `HEARTBEAT_URL` is empty in
   `apps/functions/.env.studio-yonetim-prod`; the nightly sweep logs `heartbeat_not_configured`
   every night until the owner creates the external check (`docs/RUNBOOK.md` → "Dış izleme") and the
   functions are redeployed. Loud on purpose: an unconfigured monitor must never read as a passing one.

**The panel's cold start is gone** (2026-08-14). `apphosting.yaml` sets `minInstances: 1`. Reception
used to pay **12.35 / 12.20 / 12.31 s** on the first request back — measured three times, hours
apart, against 0.22 s warm. After the change, and after fifteen minutes of deliberate idling, the
same request took **0.29 / 0.26 / 0.24 s**. Verified by waiting and measuring, not by reading the
Cloud Run setting: the service annotation says `minScale = 1` while the revision template still
reads `0`, so the setting alone would have been an ambiguous answer.

---

## What this is, in one line

A live, multi-tenant Studio Operating System. One studio uses it for real — **Pilates Fitness by
Işıl**, 120 members — and it is the only system they have: they retired the old one on 2026-07-27.
A day this panel cannot open is a day the business cannot run.

- Panel · `panel.pilatesfitnessbyisil.com` (Firebase App Hosting, `studio-yonetim-prod`, europe-west4)
- Public site · `pilatesfitnessbyisil.com` — static HTML at **`~/pilates-site`**, its own git repo
  pushed to the PRIVATE **`yunusyilmaz034/pilatesfitnessbyisil-site`** (2026-08-09; NOT in this repo,
  NOT under `~/Projects`). Two pages, `index.html` and `uyelik.html`; both read live prices from
  `/api/public/products`, so a price change alters nothing in that repo. Deploy: `cd ~/pilates-site &&
  firebase deploy --only hosting` (Hosting site `pilatesfitnessbyisil-web`, same Firebase project).
  The hand-made `.bak-` files in `~/pilates-site-backups` are what stood in for version control until
  now; they are ignored by the repo and can be retired once git has been trusted for a while.
- **The platform's own site · RetroAsistan** — static HTML at **`~/retroasistan-site`**, its own git
  repo, pushed to the PRIVATE **`yunusyilmaz034/retroasistan-site`** (NOT under `~/Projects`, NOT
  part of this repository). One page: AI reception, panel, member
  app, references, the correction trail, contact. No prices — enquiries go to WhatsApp
  `0507 966 67 82`. Deploy: `cd ~/retroasistan-site && firebase deploy --only hosting`.
  - Hosting site **`retroasistan`** → `retroasistan.web.app`. This is where the branded site lives.
  - **`retroasistan.com` is live** (2026-08-09), certificate issued by Google Trust Services. The
    domain was registered at Natro and its nameservers moved to Cloudflare — until that move the
    Cloudflare records were a draft nobody was asked for, and Firebase's Verify would have failed
    while the panel looked correct.
  - **`studyoasistan.com` 301s to it**, and the redirect is a DEPLOY, not a Cloudflare rule: the old
    `studyoasistan` Hosting site now serves nothing but a catch-all 301
    (`~/retroasistan-site/legacy-studyoasistan/`, deployed from that folder). The rule lives in
    version control beside what it redirects, instead of as a setting in a panel nobody remembers
    six months later. **This is why the two domains had to stay on SEPARATE hosting sites** —
    Firebase redirects are path-based, not host-based, so one site serving both would mean duplicate
    content with no way to redirect between them.
  - ⚠️ **`www.retroasistan.com` still points at Natro's redirect service** and does not work. Either
    delete that CNAME and add `www` as a second custom domain, or redirect it at Cloudflare.
  - ⚠️ **The domain's ICANN e-mail verification was still pending** at Natro on the day it was
    registered. Unverified for 15 days and the domain is SUSPENDED — the site and its mail stop.
    It is registered to `Işıl Yılmaz / pilatesbyisil@gmail.com`, i.e. the platform's own address sits
    in a customer's registrar account; fine while they are the same person, worth untangling before
    the trademark is filed.
  - `preview/` is excluded from deploy (`firebase.json`): it holds a references mock-up with invented
    studios, for judging the layout. It must never ship.
  - Its screenshots were taken with the panel's **demo mode** on, which is what that feature exists
    for — masked names, real numbers. Retaking one means turning demo mode back on first.
- Studio id · `retro`. Nothing in the code may assume it is the only one.

---

## Live and working

Reservations, check-in (desk · kiosk · **printed daily QR**), attendance, the credit ledger,
packages incl. hybrids, payments through PAYTR (card, links, wallet), the member portal, the member
mobile app, WhatsApp AI reception, notifications, reports, payroll, and a nightly infrastructure
watchdog (domain expiry, TLS, reachability, renewal dates + a Monday heartbeat).

Members are **Aktif, Duraklatılmış or Pasif** (OR-23) — the first two derived from the ledger, so they
are never stale. Memberships can be frozen, including past the allowance when the owner decides so
(OR-21). The movement guide and an in-app video player are in both the portal and the app.

**Members can buy and renew their own packages** from the app and the portal. A renewal is QUEUED
behind the package it renews so no paid day burns unused; a hybrid queues behind every category it
grants and refuses when they disagree. The studio is notified the moment a self-service sale lands.

## Eğitmenler sisteme girdi (2026-08-30)

Üç eğitmen hesabı zaten vardı ve kullanılmıyordu: **Işıl Hoca · Buse Hoca · Reyhan Hoca**. Owner
onları sisteme sokuyor. Kural [[OR-47]]'de; burada nerede durduğu:

| Eğitmen görüyor | Görmüyor |
|---|---|
| **Derslerim** — kendi dersleri, isim listesi, tek dokunuşla yoklama (offline çalışır) | Genel Görünüm · Kasa · Cari Hesap · Ürün Sat |
| **Rezervasyon Ajandası** · **Check-in** | Resepsiyonun **Üyeler** kartı (`/members`) |
| **Üyeler** (`/trainees`) — ad-soyad, aktif paket, program, ölçüm, fotoğraf | Telefon · geçmiş paketler · fiyat · ödeme · bakiye |
| **Antrenman** — egzersiz kütüphanesi, şablonlar, geri bildirim | Satış Hunisi · Raporlar · Analitik · Bordro · Ayarlar · Personel |
| **Bilgi Merkezi** · **Hakedişim** (kendi hakedişi) | Başka eğitmenin hakedişi · Denetim Kaydı |

**`/trainees` yeni; gerisi zaten açıktı.** Program/ölçüm yazma yetkisi 7. Fazdan beri eğitmende —
eksik olan bir ekrandı, yetki değil.

**Telefon ve para tarayıcıya HİÇ gitmiyor.** `server/trainee-query.ts` iki okuma yapıyor (üyeler +
entitlement'lar) ve yalnızca sunacağı alanları okuyor. `server/trainee-boundary.test.ts` bunu yapısal
olarak kilitliyor — o dosyalara `phone`/`balanceDue`/`priceAgreed`/`payment`/`Kurus` girerse
`pnpm check` düşer. Kanıtlandı: telefon eklendi → test düştü → geri alındı → geçti.

**Owner'ın panelinde `/trainees` yok** — onda zaten `/members` var. Eğitmen görünümünü kontrol etmek
isterse Derslerim'de olduğu gibi kendi eğitmen hesabıyla girer (2026-07-16 düzeni).

**Açık kalan:** eğitmenlerin giriş bilgileri. Hesaplar var ama owner'ın onlara şifre/davet vermesi
gerekiyor — Ayarlar → Personel'den.

## The demo studio (2026-08-26)

**`demo` — "Demo Stüdyo".** Built for a broker who asked whether there was something to show, and
handed to anyone who asks after him. `demo@retroasistan.com` / `AbQtq33SZ00O`, owner role, single
branch `merkez`.

### Read this before you run any seeding script

The demo lives in the **same Firestore database as a studio with 171 real members.** Multi-tenancy
makes that safe architecturally; it does not make it safe against one mistyped id. So the seeders do
not *try* to stay inside `studios/demo/` — `tools/seed/demo-guard.ts` wraps Firestore in a proxy
where every path outside it, **reads included**, throws before reaching the database. Reads are
locked too on purpose: reading the wrong studio and mixing it into demo data is as bad as writing to
it, and harder to notice.

Three scripts, all requiring `--apply` (dry run otherwise):

| Script | What it does |
|---|---|
| `tools/seed/demo-studio.ts` | The skeleton: catalogue, 45 members, renewals, 50 days of agenda, attendance, check-ins |
| `tools/seed/demo-extras.ts` | What the product actually *says*: WhatsApp funnel, leads, AI card, patron briefing, training, turnstile |
| `tools/seed/demo-reset.ts` | Empties `studios/demo/` — keeps `branches`, `settings`, `staff`, so the account survives |

`demo-studio.ts` is **single-pass by design**: it refuses to run when members already exist, and it
does not resume. If it dies halfway, reset and re-run. A resume branch that has never been executed
produces silently wrong data, which is worse than a re-run that costs two minutes.

### What is in it

45 members · 88 subscriptions (renewals, mixed paid/partial/outstanding) · 237 sessions over 50 days ·
936 reservations · 685 attendance records · 12 WhatsApp conversations · 11 leads across five stages ·
16 exercises · 4 published programmes · 20 measurements over 90 days · 2 turnstile devices ·
608 crossings.

The WhatsApp funnel **narrows like a real one**: 12 wrote → 9 engaged → 5 hot → 2 converted. The two
converted conversations use real demo members' phone numbers, because `/ai-report` matches the
conversation's digits against `phoneNormalized` — a made-up number silently scores zero conversions.

**Meta looks configured without being configured.** `settings/ai.whatsappActive` is `true` and the
knowledge card is full (12 FAQs, escalation rules, things-never-to-do). Credentials live in env, not
Firestore, so the flag lights the UI and sends nothing anywhere.

### What is deliberately NOT seeded

- **`settings/aiChecklist`** — it is a *cache*, and the client drops any cached row whose id does not
  match a live advisor id. The checklist fills itself from the underlying signals (outstanding
  balances, expiring packages, empty sessions, hot leads), and those are genuinely present. A faked
  cache does not imitate the real list; it just disagrees with it.
- **`/patron` chat and the AI programme draft** — a live Anthropic call per request. Not seedable.
  The *accepted* output is: two of the four programmes carry the note "AI önerisi".

### Three things measurement caught (and guessing would not have)

- `demo-reset` originally listed what to **delete** and missed `members_by_phone`: 45 members went,
  the phone index stayed, and the next run died on the first member with `phone_already_registered`.
  It now lists what to **keep**. A hand-written delete-list fails silently, and nobody updates it
  when a collection is added.
- One package per member left **24 of 66 future sessions empty** — average occupancy 1.6 in an
  8-person room. The fix was renewals, not bigger packages: giving the 8-class package 30 credits
  would have made the catalogue lie. Occupancy went 1.2 → 4.0.
- Booking randomly chosen members hit the category wall ~1400 times, each one silently returning
  null. The wall is correct; offering a fitness member a reformer slot is what was wrong. Candidates
  are now drawn from members who actually hold a package covering that service.

### A seeded studio needs the nightly jobs run ONCE

Seeding writes history; it does not write the **consequences** of history, because in production
those come from the scheduled sweeps. Right after seeding, 35 of 88 packages had a `validUntil`
weeks in the past and were still `active` — a member's screen showed three "active" packages, two of
them long dead. That reads as a bug, and to a broker it *is* one.

Fixed by running the real sweep rather than flipping a status by hand:

```ts
sweepExpireCredits({ repo: new FirestoreEntitlementRepository(lockedDb), clock: systemClock }, demoCtx)
// → { expired: 35, skipped: 0, failed: 0 }
```

Hand-flipping `status` would have produced no `entitlement.expired` events and no `expired` bucket
in the ledger — and the burned-credit churn signal, which is one of the things the product is FOR,
would have stayed at zero. It is now 71.

**Do this for any future seeded studio.** `auto-resolve-attendance` → `expire-credits`, in that
order (I-19).

### Verified, not assumed

Login was actually performed against Identity Toolkit, not inferred: the token comes back with
`studioId: demo`, `role: owner`, `platformAdmin: false`. So the broker's session cannot read `retro`
at all — the security rules gate on exactly that claim.

### Still open

The remaining ~14 empty future sessions are **kept on purpose** — the dashboard's `empty_session`
signal needs something to point at.

## Store state

| | In members' hands | Submitted / in review |
|---|---|---|
| iOS | 1.0.1 (build 4) — live since 2026-07-29 | **1.6.0** (build 11) — uploaded 2026-08-14, on top of 1.5.0 |
| Android | **1.3.0** (versionCode 9) — closed test | **1.6.0** (versionCode 12) — uploaded 2026-08-14 to the CLOSED TEST track; production ACCESS still under review |

✅ **Android production access was granted, and the alpha-track trap fired exactly as written
(2026-08-15).** `eas.json` hardcoded `"track": "alpha"`, so 1.6.0 sat in the closed test while the
store served 1.5.0 — the owner noticed because the market showed the old version. `eas.json` now
says `"track": "production"`; future submissions go straight there.

1.6.0 (versionCode 12) was promoted to production at **100%** on the owner's explicit instruction —
a staged 20% rollout was offered for a release that changes every screen, and declined. No rebuild
was needed: the same artefact was already uploaded, so the promotion was a track change, not an
upload.

**It went up with release notes that did not exist.** The build had been uploaded to the closed
track with none, and promoting as-is would have left "Yenilikler" empty on the largest visual change
the app has had. Turkish notes were written and attached with the promotion. The store is
single-language (`tr-TR`).

**"Which version is actually on the market?"** has one honest answer, and it is not the Play Store
listing — Google hides the version there. It is the Play Developer API's track list, read with the
submission service account (`apps/mobile/google-play-service-account.json`, scope
`androidpublisher`): production / alpha / internal with their versionCodes side by side. The Console
route is *Test edin ve yayınlayın → Üretim → Kanal özeti*.

**Ship 1.6.0 and nothing else. 1.1.0 … 1.5.0 are all superseded** — each is contained in the next,
and 1.2.0's video player is broken (OR-22). Several were built, uploaded and never sent for review;
let them lapse rather than spend a review turn on any of them. 1.6.0 carries everything 1.5.0 did —
the late-cancel block (OR-30), workout tracking (OR-33), the consistency strip, one price (OR-31) —
plus the turnstile's six-digit scanner and the premium UI redesign below.

**The next mobile build is 1.6.0**, bumped on 2026-08-09 along with the white-label work (A4). It
carries the turnstile's six-digit scanner, which had been sitting in the tree under a 1.5.0 label —
a build made before the bump would have reached the stores calling itself 1.5.0 while behaving
differently from the 1.5.0 under review.

**1.6.0 also carries the premium UI redesign (2026-08-14, owner's UI Board).** It is a RE-SKIN, not a
rewrite: no API contract, no business rule and no screen's information changed. What changed is the
type (serif → Poppins, loaded in `app/_layout.tsx` behind the splash) and the surface (hairline rules
→ layered cards). `src/theme.ts` is now semantic tokens with the old names kept as ALIASES, so a
screen migrates on its own day and the app is never half-broken; `src/components/kit.tsx` is the new
component set and `src/components/ui.tsx` is the old one, retuned to the same proportions so the
not-yet-migrated screens do not look older than the migrated ones. `ui.tsx` shrinks as screens move;
when it is empty it goes.

Migrated onto the kit: Bugün · Ajanda (both views) · Antrenman · Ben · Abonelikler · Mesajlar ·
Rezervasyonlar · Cüzdan · İletişim · Paket Al, plus the tab bar. Verified in the iPhone 17 simulator.
Three real defects were found and fixed while doing it, none of them cosmetic:

- **Ajanda offered "Rezerve" on a row reading "Son 0 yer".** The server refuses it, so the screen was
  announcing a refusal it already knew was coming. A session with no seats is now `Dolu`.
- **`reservations.tsx` printed raw statuses to the member** — `late_cancelled`, `auto_resolved` — for
  anything other than attended/no_show. `STATUS_TR` existed for exactly this and was not being used.
  OR-30 says the member never meets the studio's accounting word.
- The studio-note card said "…'dan sana not" twice, because both the card and its caller added it.

Two things deliberately NOT done, so nobody thinks they were missed: the sender suffix is always
`'dan`, which is correct for "Işıl" and wrong for a second studio whose name needs `'den` — it needs
vowel harmony before the platform has two customers. And `npx expo lint` does not run at all: the
config ignores `src`, so this app has never been linted. `apps/mobile` is not in `pnpm check` either.

**`app.json` is gone**; the manifest is now `app.config.js` + `studios/retro.json`. `npx expo config`
prints the resolved result. The version lives in `app.config.js` and is deliberately NOT per studio.

**Android's 14-day production clock is DONE** — confirmed in Play Console on 2026-08-09: all three
prerequisites struck through (closed test published · 12 testers enrolled · 14 days served) and
"Üretime başvur" is live. Production itself still reads *Etkin değil*: the requirement being met
does not grant access, it only unlocks the application, which Google reviews by hand.

**The campaign permission was switched on for every member (2026-08-18), by the owner's explicit
decision.** 160/160 now carry `notificationPrefs.campaign = true`. He states KVKK notice and written
explicit consent were collected on paper; he is the data controller and that basis is his to assert.

**The distinction was put to him first, because it is the part a script cannot judge.** The app
writes preferences in exactly ONE place — a member flipping a switch in Profil — so the stored state
means something: 111 members had no preference object at all (never opened that screen), 46 had
`campaign: false` in an object they themselves caused to be written (they saw that screen and left
the switch alone), and 3 had already turned it on. He chose all of them, knowingly. Recorded here
rather than only in a commit message, because the question returns the first time someone replies
"beni bu listeden çıkarın".

**Only `campaign` was touched**, with a merge write: push, e-mail, SMS and WhatsApp survived exactly
as they were (48 push, 8 SMS, 5 WhatsApp, unchanged after the run). Missing fields still resolve to
`DEFAULT_PREFS` because both tiers read `{ ...DEFAULT_PREFS, ...stored }` — checked in
`notification-deps.ts` AND `on-event-notify.ts` before running, since a whole-object write there
would silently have muted operational e-mail and SMS for 111 people.

Script: `tools/migration/enable-campaign-consent.ts`, dry-run by default.

**A template exists for the announcement**: `app_available`, category `marketing` (so the permission
above is what gates it), with the STORE LINKS in the body rather than "search for us" — the old
BulutGym "Pilates by Işıl" app is still listed, and a member who installs that one cannot log in and
blames herself. Editable per studio from Ayarlar → Bildirimler without a deploy.

**Two members were sold the wrong product, and it was repaired (2026-08-17).** Gülcan Ayvaz and
Hava Kolu bought a THREE-month fitness package on 2026-08-03; reception picked "Fitness - 6 Aylık"
at 13.000 ₺. Agreed, per the owner: 9.000 ₺ list, 1.000 ₺ discount, 8.000 ₺ cash, no debt either
side. Both now read Fitness - 3 Aylık, 03.08 → 01.11.2026, sale settled at 8.000 ₺.

**Reading the records first is what made this safe** — the two members were NOT in the same state.
Gülcan's first 13.000 ₺ cash payment had already been voided at the desk and a real 8.000 ₺ one
stood: her money was right. Hava's 13.000 ₺ was live and fully allocated, so the books held 5.000 ₺
of cash nobody ever took. Only hers was voided and re-recorded at 8.000 ₺; the till moved −5.000 ₺,
which is the correction, not a loss.

**`AmendPatch` gained `productSnapshot`** (`packages/core/.../entitlements/domain/decide.ts`). The
snapshot is frozen so a catalogue edit cannot rewrite a purchase — but a mis-entry is not a
catalogue edit, and the record described a sale that never happened. The amend event carries the old
product and the new one by id and name, with a mandatory reason. **It is deliberately not exposed in
the panel**: changing what somebody bought is break-glass, not a button reception meets on an
ordinary Tuesday, and the money it implies must be settled in the same breath.

**The sales' GROSS stays 13.000 ₺.** Rewriting it would be the silent edit the ledger exists to
prevent. Two discounts carry the truth instead — 4.000 ₺ "wrong product" and 1.000 ₺ "agreed" — so a
reader sees both facts. Script: `tools/migration/fix-wrong-product-2026-08.ts`, dry-run by default,
written by a `migration` principal.

**The drifted package dates are repaired (2026-08-14).** Seven entitlements across five members —
Çağla Kökener, İrem Kılıç, Gülcan Ayvaz, Buse Ertaş and Şule Gürses; the bundles are two rows each.
The owner supplied the true START dates from his own records and the END dates were recomputed as
start + the product's own duration, the same arithmetic the sale used.

Buse's row proves the method independently: her cancelled first attempt still stands at
`13.08 → 12.09`, which is exactly what the recomputation produced for her live pair.

**İrem's row is the one exception, and deliberately so.** Her window was recorded as 31 days against
a 30-day product, so the drift had added a day at the front without moving the end. Only her
`validFrom` was corrected; her end date was left alone. Moving it too would have handed her a second
day she was never sold, and correcting the start alone takes nothing from her.

The script is `tools/migration/fix-drifted-dates.ts` — dry-run by default, `--apply` to write, and a
second run is a no-op because `amendEntitlement` emits nothing when a patch changes nothing. It
writes as a **`migration` principal** (`mig_2026_08_14_date_drift`), never as reception: she did not
make this change and the log must never say she did. All seven `entitlement.amended` events were
verified in `/studios/retro/events` after the run, each carrying its reason.

The input bug that caused this is already fixed (`STUDIO_UTC_OFFSET_MIN` in
`members/subscriptions.tsx` and `members/member-form.tsx`); this was the repair of the rows it had
already damaged.

⚠️ **Play rejected the Android update on 2026-08-14 — a POLICY rejection, not a build one.** "Sağlık
İçerikleri ve Hizmetleri politikası: Sağlık uygulamaları beyanı yanlış": the app's health features do
not match the Health apps declaration form, and Play named the category **Aktivite ve Fitness**. The
previous version stayed available to members throughout, so nothing in anybody's hands broke.

What the app actually does, health-wise — checked against the code, not assumed: it DISPLAYS body
measurements taken on the studio's own scale (weight, ideal weight, lean mass, muscle, water, fat in
kg and %, plus circumferences — entered by the studio, read by the member), shows trainer-assigned
workout programmes, and records class attendance. Android permissions are `CAMERA` and
`RECORD_AUDIO` only; there is no Health Connect, no sensor and no health-record integration. So the
honest declaration is **Activity and fitness — workout tracking and body measurements — and every
medical category left unchecked**. Anything medical ticked on that form is a false declaration.

The owner corrected the form and resubmitted the same day. **If this rejection ever returns, the fix
is the form, never the build** — a rebuild changes nothing about it.

**Applied on 2026-08-09 at 17:46, without waiting for 1.6.0** — production access is granted to the
app, not to a build, so the review runs in parallel with preparing the turnstile release rather
than behind it. **Keep every tester enrolled until it is approved**: a rejection puts the counter
back in play, and a tester leaving RESETS it. Publishing new builds does not.

**What was answered, kept so a re-application cannot contradict the first.** The application asks in
prose across three steps. The line taken was the honest one, and it was strong because the closed
test was real:

- *Who the testers were* — the studio's own members and reception staff, invited face to face, plus
  a few friends. No paid testing provider.
- *What they did* — used it daily for its actual purpose: booking, cancelling, QR entry, remaining
  credits, workout tracking. **The one divergence from expectation was declared rather than hidden**:
  in-app payment was barely used, because members still prefer to pay at the desk. That is true —
  this system has never executed a single real card charge — and answering "everything went well"
  to a question that asks for divergences is the answer an untested app also gives.
- *What the feedback produced* — **five releases in two weeks (1.1.0 → 1.5.0)**, each traceable to a
  reported fault: the wallet screen that trapped the member with no back button (OR-25), the video
  player that failed on every exercise (OR-22), past reservations burying the agenda (PF-43), the
  show-password eye (PF-44), empty modules on the home screen, workout tracking (OR-33).
- *Audience and scale* — a closed audience (≈120 members of one studio, invite-only), and therefore
  **0–10k installs in the first year**. Claiming a bigger number would have contradicted the
  audience answer one box above it. ⚠️ That answer says the studio is in **İstanbul**; it is in
  **KOCAELİ**. Submitted and not editable, and Google does not reject over a city — but if the
  application comes back and is refiled, correct it.
- *Readiness* — daily real use, every reported item closed, no blocking fault in the last fortnight.
  A crash-free claim was deliberately NOT made: nobody had checked Android vitals, and Google can
  see that data whether or not we cite it.

Submissions are automated: `cd apps/mobile && npx eas-cli submit --platform android --profile
production --latest`. The Play service account key is gitignored at
`apps/mobile/google-play-service-account.json` (`eas-play-submit@studio-yonetim-prod...`); the
`androidpublisher` API is enabled on the project. iOS submits the same way but the App Store version
must still be created and sent for review by hand.

---

**DNS can be changed from this machine (2026-08-17).** A scoped Cloudflare API token lives at
`~/.config/cf-dns-token` — outside the repo, `chmod 600`, never committed. Its scope is deliberately
one line, `Zone → DNS → Edit`, on the studio's zone only; it cannot see billing, other accounts or
anything else, and it **expires** (a TTL was set at creation, so one day it will simply stop working
rather than outliving its purpose). A broad "Cloudflare Agent Token" with 174 permissions across all
zones also exists in that account and was deliberately NOT used — worth deleting if nothing needs it.

First use: the DMARC report address moved off a personal Gmail. `_dmarc.pilatesfitnessbyisil.com`
now reads `v=DMARC1; p=none; rua=mailto:info@pilatesfitnessbyisil.com`, verified through both
Cloudflare's and Google's resolvers.

**The domain's mail is correctly set up**, which the DMARC reports exist to confirm: SPF covers
Natro (the `info@` mailbox), and `resend._domainkey` covers what the panel sends as
`noreply@pilatesfitnessbyisil.com`. DMARC is `p=none` — monitoring only. Tightening it to
`quarantine` would protect the brand from spoofing but must wait until every sender is known to
pass, or it puts the studio's own mail in spam.

## Waiting on the owner

- ✅ **The public site was given the search equipment it never had (2026-08-16).** Repo is
  `~/pilates-site` (separate, private). What was found and fixed, because the finding matters more
  than the fix: **two domains served byte-identical content** — `pilatesbyisil.com` and
  `pilatesfitnessbyisil.com`, both 200, neither redirecting, no canonical anywhere — so Google was
  treating them as two sites and had picked the *other* one. Both point at the same Hosting site, so
  a `canonical` consolidates them without touching DNS.

  Added: canonical, robots meta, Open Graph, `robots.txt`, `sitemap.xml` (6 URLs), and a
  `HealthClub` JSON-LD carrying the real address, the coordinates read off the studio's own Maps pin,
  opening hours, services and the districts served. Four service pages written to be read rather than
  to rank — `/reformer-pilates`, `/hamile-pilates`, `/kadinlara-ozel-fitness`, `/ozel-ders` — linked
  from the home page's own service headings so its layout and animations were left untouched.
  Photographs converted to WebP (3 MB → 1 MB) and everything below the fold lazy-loaded; the hero
  deliberately is not, because deferring the largest paint would look like an optimisation while
  being the opposite. Search Console is verified as a Domain property and the sitemap is accepted.

  **Two things deliberately NOT done.** No district pages — "Gebze pilates" / "Darıca pilates" clones
  are doorway pages and Google penalises them; the districts live in `areaServed` and in honest
  sentences. And the 4.9/124 rating is **not** in the markup: self-serving review markup on your own
  site is prohibited and penalised. It stays on the page as text.

  The two videos are untouched — `tour.mp4` alone is 3.7 MB and autoplays, still the heaviest thing
  on the page. Compressing needs ffmpeg (absent here) and changing autoplay changes how the page
  feels, which is the owner's call.

- ⏳ **The studio's Google Business Profile cannot publish edits — waiting on Google (2026-08-16).**
  Nothing is broken and nothing is lost: the profile is live on Maps with **4.9 / 124 reviews**, the
  owner manages it, and members find it. What does not work is *changing* it — the profile sits in
  "doğrulama gerekiyor", so every edit queues instead of publishing.

  **How it got here, so nobody re-derives it.** There are TWO entries in the owner's Business Profile
  Manager for one studio — "pilates by ışıl" (No:28/T, 41420, marked *Kopya*) and "Pilates Fitness By
  Işıl" (Alyans Sitesi No:28T, 41000, *Doğrulama gerekiyor*) — and **both open the same profile**.
  Video verification was submitted and rejected; the panel then says "başka doğrulama yöntemi
  kalmadı". Deleting the spare entry does nothing: Google refuses, which is a safety net, not a bug.

  **Do not delete either entry.** Both lead to the same profile, so no one can tell from the list
  which deletion destroys what, and the downside is 124 reviews that took years to earn.

  **There is no support form.** Google removed direct contact for Business Profile; "Geri bildirim
  gönder" is an anonymous suggestion box, not a ticket. The only working channel is the **Help
  Community** (`support.google.com/business/community`), where Product Experts escalate. A thread was
  posted on 2026-08-16 under the *"İşletmenizi doğrulama ve başlama"* category, asking for the two
  entries to be merged **with the reviews preserved** and the profile verified. No documents were
  posted — the forum is public.

  **A Product Expert answered the same day** and confirmed the diagnosis: the block is the two
  conflicting entries, not the video. Their instruction — name, address and postcode in ONE correct
  form, matching the signage and official records — was half ours to do, and it is done: the site's
  structured data now reads **"Pilates by Işıl"** (matching the signage and Maps; the SITE was the
  outlier, with "Pilates Fitness by Işıl" kept as `alternateName`), address **Akse Mah. Karasu Cad.
  Alyans Sitesi No:28/T**, postcode **41420**, across the home page and all four service pages. No
  visible copy changed.

  **The postcode was checked, not assumed, and the live profile has it wrong.** Akse Mah., Çayırova
  is **41420**; the profile carries **41000**, which is Kocaeli's generic code and belongs to no
  neighbourhood. Fix it the day editing unlocks — and it may itself be part of why Google sees two
  conflicting records.

  **While it waits**, three things still work and still matter: replying to reviews, uploading
  photos, and the Google review link for the notification template (blocked only because the link
  comes from the profile dashboard). Retry verification weekly — "no methods left" is not permanent,
  and **postcard** often reappears and is what usually succeeds after a video rejection.

- 🟡 **TAMI as a second payment provider — UNBLOCKED on the technical question, still waiting on the merchant
  application (answered 2026-08-17).** Tami's technical support replied with a v3 Postman collection,
  and it settles the thing that mattered: **the hosted page HAS an API.**

  ```
  POST {base}/hosted/create-one-time-hosted-token
  headers: PG-Auth-Token: <merchant>:<terminal>:<hash> · PG-Api-Version: v3 · correlationId: <per txn>
  body:    { amount, orderId, successCallbackUrl, failCallbackUrl, mobilePhoneNumber }
  ```

  No card fields and **no `securityHash`** in that request — so the hosted flow needs none of the JWK
  request-body signing the direct card API demands. We mint a token, the customer enters her card on
  Tami's page, the result returns to our callback. Card data never touches us, which was the whole
  point of choosing this model over `/payment/auth` + `/payment/complete-3ds`.

  The `PG-Auth-Token` hash is derived from merchant + terminal + apiKey via `/admin/generate-hash`
  (basic auth), not computed locally. Sandbox base is `sandbox-paymentapi.tami.com.tr`; the sandbox
  portal is `sandbox-portal.tami.com.tr`, and Tami's advice is to log in with "şifremi unuttum" using
  the phone number belonging to whichever test merchant you are exercising.

  **Credentials are deliberately NOT in this file** — this repo is on GitHub. The shared sandbox
  merchant/terminal/secret sets and the Postman collection are in the mailbox
  (`teknikdestek@tami.com.tr`, thread `ST1708013TFFY`, 2026-08-17). The studio's OWN `k` / `kid` are
  per-merchant and arrive with the real account.

  **PROVEN against sandbox on 2026-08-17**, not assumed: the call below returned a real
  `oneTimeToken`, so the hosted flow is genuinely available to us with the credentials we hold.

  ```
  POST https://sandbox-paymentapi.tami.com.tr/hosted/create-one-time-hosted-token
  headers: PG-Auth-Token · PG-Api-Version: v3 · correlationId · Accept-Language
  body:    { amount, orderId, successCallbackUrl, failCallbackUrl, mobilePhoneNumber }
  →        { "oneTimeToken": "...", "tokenCreateTime": "..." }
  ```

  **The whole contract is known (2026-08-17). It was on Tami's own page all along** — the doc is
  rendered by JavaScript, so every reader that fetches the page sees an empty shell; the text is in
  the raw HTML. Three days of "the documentation is not public" was a fetching problem, not a Tami
  problem. When a vendor page looks empty, read the source before believing it.

  ```
  1. mint    POST {base}/hosted/create-one-time-hosted-token   → { oneTimeToken, tokenCreateTime }
  2. send her to  https://portal.tami.com.tr/hostedPaymentPage?token=<oneTimeToken>
                  (sandbox: sandbox-portal.tami.com.tr, same path)
  3. she pays on Tami's page (Masterpass or a new card), then Tami REDIRECTS her to
     successCallbackUrl. `failCallbackUrl` is currently unused — failures stay on Tami's page.
  4. confirm by ASKING Tami: /payment/query on the orderId.
  ```

  **`PG-Auth-Token` is derivable locally — no admin endpoint needed:**
  `merchant:terminal:Base64(SHA256(merchant + terminal + secretKey))`. Verified by reproducing the
  exact token Tami shipped in their own Postman collection.

  **Step 4 is not optional.** Nothing signed comes back — the customer simply arrives at our URL, and
  a browser redirect is forgeable by anyone who knows the address. Tami's own doc says the same:
  *"İşyerinin cevap alamadığı durumda, tami/Query servisi ile işlem durumunu sorgulaması beklenir."*
  PAYTR is verified by signature; TAMI is verified by query. A `payment.received` written on the
  strength of a redirect would be money invented by whoever typed the URL.

  Token lifetime: 15 min in test, **6 min in production**. Phone must be `905xxxxxxxxx` — Masterpass
  needs it and it is mandatory.

  **THE ADAPTER IS BUILT (2026-08-17, `packages/core/.../infrastructure/tami-provider.ts`).** It is
  the second implementation of `PaymentProviderPort` — the reason that port exists. 20 tests.

  What works today: minting a checkout and producing the hosted-page URL. What refuses today, on
  purpose: `verifyCallback` (always no — the redirect is not evidence), `confirm` (needs the JWK) and
  `refund` (needs the JWK). So a TAMI payment can be STARTED and cannot be COMPLETED, which is the
  correct half to be missing while credentials are absent — nothing can credit a member who has not
  paid.

  `confirm` was added to the port as an OPTIONAL method: providers that prove themselves with a
  signed callback (PAYTR) do not implement it; providers that can only be asked (TAMI) must. The
  signing is written and tested — `securityHash` is a JWT, HS512, `kid` in the header, payload = the
  body with `securityHash: ""`, HMAC key = the base64url-DECODED `k`. Decoding that key is the step
  that will silently produce valid-looking, always-rejected tokens if skipped.

  **Deliberately NOT done: TAMI is not offered to reception anywhere.** Config selects one provider
  per studio (`settings/paymentProvider.provider`), and the env vars are commented out in
  `apphosting.yaml`. Exposing it now would let somebody take a real payment we cannot credit.

  **Tested against sandbox on 2026-08-18, not simulated.** Minting a token works. `/payment/query`
  works and refuses correctly: an order that was never paid answers HTTP 400 with
  `{ success: false, errorCode: 2013, errorMessage: "Bu sipariş üye işyerine ait değildir." }`, and
  that exact answer is now a test. Tami SIGNS its own responses (`securityHash` comes back), which
  we do not currently need — we call them over TLS — but it is there if it is ever wanted.

  **The paid shape is still unobserved.** Nobody has completed a sandbox payment, so `confirm` gates
  on Tami's own `success` flag (which we HAVE seen) and keeps a second, guessed status check behind
  it. Both must agree. The first real sandbox payment should replace the guessed field names with
  the ones Tami returns — until then it refuses rather than assumes, which is the right way round
  for something that grants a package.

  **Tami answered on 2026-08-18** and confirmed by omission what the adapter already assumed: asked
  how the callback is signed, they simply said the result comes back on `successCallbackUrl`. There
  is no signature. Confirming by query is not belt-and-braces, it is the only mechanism.

  **The signing endpoint is usable in sandbox without holding the JWK:**
  `POST /api/v0/admin/generate-jwk-signature` with Basic auth (credential is in Tami's own Postman
  collection) returns the `securityHash` for a given body, and the token it returns carries the test
  merchant's `kid`. Production `k`/`kid` come with the real account.

  **The one thing still missing** is the JWK (`k` / `kid`) that signs `securityHash` on the Query
  call. It is per-merchant, from the portal (işyeri ayarları → POS yönetimi), and arrives with the
  real account.

  **Do not trust the callback when it arrives.** A browser redirect is forgeable by anyone; "payment
  succeeded" must be confirmed by asking Tami ourselves, via `/payment/query` on the orderId. That
  needs `securityHash`, hence the JWK (`k`/`kid`) — the third question in that mail. PAYTR is
  verified by signature; Tami will be verified by query.

  **Still blocked for production:** Tami says the membership is under evaluation, and the hosted page
  can only be requested for the live environment *after* it is approved. Sandbox can be built against
  today; going live is a separate request to them.

- ⏸️ **(superseded) TAMI — the earlier note, kept for the reasoning.** SUSPENDED as of 2026-08-14. Nothing is blocked on us; nothing has been built. Resume when the application
  clears. The research is written down here so nobody repeats it:

  **Use the hosted model, not the direct API.** `dev.tami.com.tr/api-katalog` lists only Tami's
  **direct Sanal POS**, where the merchant posts `card: { number, cvv, expireMonth, expireYear }` to
  `POST /payment/auth`, renders the returned `threeDSHtmlContent` itself, then calls
  `/payment/complete-3ds`. Building that would put card data through our servers and pull the studio
  into PCI DSS scope — a liability far larger than the problem it solves. Tami also sells **Ortak
  Ödeme Sayfası** and **Linkli Ödeme**, which work like PAYTR: the customer enters the card on
  Tami's page and we hold a redirect URL. The owner chose that model on 2026-08-14. Do not quietly
  fall back to the direct API because its documentation is the easy one to find.

  **Where the documentation actually is** (corrected 2026-08-14 — the first note here was wrong).
  `dev.tami.com.tr/api-katalog` has a SOLUTION FILTER on the left: *Tami Sanal POS · Linkli Ödeme ·
  Ortak Ödeme Sayfası · Açık Kaynak Eklentileri*. The default view shows only Sanal POS's 13 APIs,
  which is how "Tami is a direct-card API" becomes the obvious and wrong conclusion. The filter is
  client-side, so fetching the URL with a query parameter returns the same default list.
  `/tami-ortak-odeme-sayfasi` does exist, but it is a product description — no endpoint, no fields,
  no callback, no hash — and it points at `TeknikDestek@tami.com.tr` for the real thing.

  **What must be obtained before any code:** the Ortak Ödeme Sayfası / Linkli Ödeme integration
  document (endpoint, request fields, how the page URL is obtained, callback fields, hash
  verification); the terminal credentials `merchantNumber`, `terminalNumber` and the JWK's `k` and
  `kid`; and sandbox access with test cards. The merchant portal's own banner says integration can
  be completed WHILE the application is under evaluation — "Bu süre zarfında entegrasyon işlemlerini
  tamamlayabilirsin" — behind an **Entegrasyon Portalı** button on `portal.tami.com.tr/dashboard`.
  That button is the first place to look; the owner has access to it (merchant 77030412).

  **The decisive unknown (2026-08-14, after reading every public page).** Tami's entire *API*
  surface — the catalogue's 13 endpoints, the support centre's FAQ, the security-hash doc — is the
  DIRECT Sanal POS. The `/tami-ortak-odeme-sayfasi` and `/tami-linkli-odeme` pages contain no
  endpoint, no request schema, no callback fields and no hash rule; they are written in product/panel
  language ("adres bilgileri talep et", "stok sınırlama"), and the merchant portal has a **Linkli
  Ödeme** page in its own sidebar. So either the hosted products are PANEL-ONLY, or their API doc
  lives behind the Entegrasyon Portalı login. Nobody should write code until that is answered.

  Why it decides everything: our flow needs a link created PROGRAMMATICALLY for one specific sale,
  and a callback we can verify and settle that sale with (OR-37). A link a human makes in Tami's own
  panel cannot be tied to our sale, sends us no callback, and leaves the money to be reconciled by
  hand — which is the work the product exists to remove. A question to `TeknikDestek@tami.com.tr`
  settles it in one round trip; the draft the owner was given asks exactly that.

  **Sandbox test cards are public** at `dev.tami.com.tr/test-kartlari` (Garanti, Ziraat, Vakıfbank,
  QNB, Halkbank, İş, Akbank, TEB), sandbox portal `sandbox-portal.tami.com.tr`. Useless until there
  is an endpoint to call.

  **What is already known about Tami auth** (from the direct-API docs, and likely shared): request
  bodies are signed as a **JWT, HS512**, using the JWK's `k` as the HMAC secret, sent in
  `securityHash`; headers `PG-Api-Version: v3`, `PG-Auth-Token: merchantNumber:terminalNumber:hash`,
  `correlationId` per transaction. Sandbox base `https://sandbox-paymentapi.tami.com.tr`.

  **Our side is ready and small.** `PaymentProviderPort` is four methods — `createCheckout`,
  `verifyCallback`, `refund`, `configured` — and PAYTR is its only implementation. Tami becomes the
  second; the intent, event, callback and reconciliation paths do not change. **PAYTR stays**: the
  owner wants both, selectable at the point of payment ("PAYTR link ile ödeme" / "TAMI ile").

  **Two things to get right when it resumes.** `PaymentIntentCreatedPayload` carries
  `provider: PaymentProviderId`, today the single literal `'paytr'` — widening it to
  `'paytr' | 'tami'` touches an EVENT PAYLOAD. It is additive and backward-compatible (old events
  stay valid, no version bump or upcaster), but event schemas are the owner's call. And do not put
  the TAMI option in reception's dropdown until the provider can actually take money: a dead option
  is worse than none, because the first person to find it is reception, standing in front of a
  member.


- ~~**iOS 1.5.0's App Store version.**~~ Done — it reads *Waiting for Review* as of 2026-08-09.
  Keeping the recipe for next time: App Store Connect → + Version → fill "What's New" in BOTH
  Turkish and English (an empty Turkish field greys out "Add for Review", which cost a day) → pick
  the right build → submit. Reviewer credentials, on both stores: `0500 000 00 01` / `Yu156211` — a
  member with a live package and a programme, excluded from every report. **Say in the notes that
  login is by PHONE NUMBER, not e-mail**, or the reviewer hunts for an e-mail field, fails to sign
  in, and rejects the build.
- **Android production access: applied 2026-08-09 17:46, under review.** Google says usually seven
  days or fewer, by e-mail to the account owner. Nothing to do but wait — and **keep all twelve
  testers enrolled until it is approved**, because a rejection puts the fourteen-day counter back in
  play and a tester leaving resets it. What was answered is in the store section; if it comes back
  rejected, reapply from those answers rather than writing new ones that contradict them.
- **The turnstile — STAGE 4 IS ELECTRICALLY DONE, THE MAPPING IS NOT (2026-08-29, 00:15).**
  Two screens, two identities, one board: both draw, both mint their own codes, both `lastSeenAt`
  are current, and a scan turns the arm. What is NOT settled after a night of re-wiring is **which
  physical screen is which door**, and whether In1/In2 are the right way round.

  Do not sort that out by swapping wires. `-D TESHIS` replaces the QR with a status block that
  prints the door's own name (`giris` / `cikis`) plus code, wifi, heap and uptime — the screen tells
  you what it is. Two minutes: read the names, mount each screen on the side it names, scan, listen
  for which channel clicks, and if the channels are crossed it is one line in the firmware.

  **The trap that ate the night: white is not a colour we draw.** An ILI9341 that never got its init
  sequence shows white. I read "white" as "the drawing stopped half way" and spent hours in the
  wiring, the backlight, continuity, and a second display. The panel had simply never been
  initialised — because both screens shared `RESET`, and the second object's `begin()` pulsed that
  line and left the first panel unconfigured. Giving the second instance `-1` for its reset pin fixed
  it. `TESHIS` mode is what finally showed this, and it exists now because this board emits no serial
  at all (0 bytes, on every combination of `CDC_ON_BOOT` / `USB_MODE` / DTR tried).

  **Known defect, to fix with a test — not at midnight.** The code is consumed BEFORE the check-in is
  decided, so when the check-in is refused (the 45 s debounce, say) the code is already spent, the
  device sees `crossed`, the arm turns and the screen says "Hoş geldin" — while the member's app says
  "geçersiz kod" and nothing is recorded. A door that opens without a record is how counts drift.
  Consume-first exists to stop two phones redeeming one code; reordering must not reopen that race.

- **The turnstile — STAGE 3 WORKS ON THE BENCH (2026-08-28).** Scan → server records the crossing →
  device asks "was my code used?" → relay pulses → greeting. The whole chain, end to end. Firmware
  in `apps/turnstile`; the pairing tool is `pnpm setup:turnstile`. Still to do: the second screen and
  exit device (stage 4), then mounting and the F01–F04 / OP-R / OP-L tests on the real arm.

  **The wiring that works — write it down once, do not re-derive it:**

  ```
  4-pin header (ESP32 side)        3-pin header (coil side)
    Vcc   → ESP32 3V3   ← NOT 5V     JDVcc → USB +5V
    Gnd   → ESP32 GND                Gnd   → USB GND
    In1   → ESP32 GPIO 5             Vcc   → empty
    In2   → ESP32 GPIO 4             JUMPER CAP REMOVED
  ```

  **Why the jumper comes off.** With it on, both the optocoupler and the coil run from 5V, so the IN
  pins sit at 5V — wired to 3.3V GPIOs that is a back-feed: the ESP32 would not boot at all, and with
  the ESP32 off *both relays energised*, which on a wall means the door stands open when the
  controller dies. Splitting the supplies fixes both: inputs at 3.3V, coil at 5V, and no power on the
  input side means the relays sit still. The two grounds stay separate — that is what the optocoupler
  is for.

  Screen (LockerBox 3.2" ILI9341, 240×320): `VCC→3V3 · GND→GND · CS→10 · RESET→8 · DC→13 · SDI→11 ·
  SCK→12 · LED→18`. Touch (`T-*`) and `SDO` unused. The relay is active-LOW; `darbe()` drives the pin
  low for 300 ms and returns it to INPUT, and `setup()` leaves both pins INPUT on purpose so a boot
  glitch cannot open the door.

  **The trap that cost an afternoon.** The screen stopped working and I searched the hardware —
  continuity on all eight lines, a second display, and a serious discussion about whether a 1600 TL
  module was dead. Both displays were fine. The board simply had no valid application on it; a
  reflash brought it back on the first try. The reason it took so long is that
  `ARDUINO_USB_CDC_ON_BOOT` was 0, which sends the log to a UART bridge **this Mac never
  enumerates** — so "nothing on serial" read as *no information* when it meant *we are blind*. It is
  1 now. If a device ever goes quiet again: make the log readable FIRST, then reflash, and only then
  reach for the multimeter.
- ~~**The Meta invite template `uyelik_daveti_v2`.**~~ Approved, and the code switched to it on
  2026-08-09. **Every template we have at Meta is now approved; nothing is pending.** The switch
  also repaired a path that had been quietly broken — see the release note below.
- **Twenty-one members are DURAKLATILMIŞ** — no live package (2026-08-01, measured). After the fitness
  import that is most likely the genuine number (lapsed, or leads entered as members) rather than
  migration debt. They now have their own filter with a count, which is the list to work through.
- **Sixty-six invitations are still unopened.** The invite screen has the filter and a one-tap
  reminder that mints a fresh link.

## Waiting on us

- **The AI receptionist is healthy; demand is what fell.** (2026-08-05) The owner saw a quiet day and
  asked if something was broken. Nothing is: every incoming WhatsApp message got an AI reply, 100% on
  every day of the week, and the webhook logged zero errors. What dropped is INBOUND — 67 messages on
  1 Aug, 21, 15, then 9 on 4 Aug. That is an advertising/seasonality question, not a
  software one. **The reason first written here — "early August empties İstanbul" — was wrong: the
  studio is in KOCAELİ, not İstanbul.** The drop is real; that explanation was not. Worth checking the ad budget and the number's quality rating in
  WhatsApp Manager before assuming either way.

- **`main` was rewritten once, on 2026-08-03, and the original is kept.** Three unrelated changes went
  out under one commit whose message described only the first of them; the tree was identical but the
  log was misleading, and in this repository the log IS the history. It was re-split into three
  commits (`67054b7` reservations · `fdd9ffb` mobile navigation · `c13cf26` PF-44) and force-pushed
  with `--force-with-lease`. **The pre-split commit is preserved as `backup/pre-split-2026-08-03`,
  both a branch and a tag**, and `git diff` between it and `main` is empty — nothing shipped changed.
  If you pulled between roughly 12:30 and 13:00 that day, reset to `origin/main`.

- **Hybrid purchase, tested live.** One sale must produce N entitlements correctly through the real
  PAYTR path. The rules are written and unit-tested; the path has never run in production.
- **Sanal POS, a real charge.** Also never run for real. Together with the hybrid sale these are the
  two money paths this system has never actually executed — close them before a second studio.
- **The freeze initiative (OR-21) has never been used on a real member.** Watch the first one: the
  membership must extend by the APPROVED days (not the budget), her allowance must then read 0, and
  the nightly sweep must resume her on the approved day. It has no unit tests — the owner's call,
  taken knowingly. If it misbehaves the two places to look are `grantedDays` in `decideFreeze` and
  `budgetEndsOn` in the sweep.
- **Twenty-one duraklatılmış members are a work list nobody has worked.** They now have a filter with
  a count; that is the win-back call list.
- **The turnstile's device firmware.** Deliberately unwritten until the S150 is in hand — writing it
  blind means debugging the firmware and the protocol at the same time, against hardware nobody has
  held. Everything on our side is built, tested and live; `pnpm setup:turnstile` mints the pairing.
- **External uptime monitoring.** The watchdog cannot report its own suspension — if the project is
  suspended over an unpaid bill, every alarm goes quiet, which looks exactly like all-clear. The
  Monday heartbeat covers this partially by making silence the signal.
- **Product roadmap Faz A** (`docs/PRODUCT-ROADMAP.md`) — **nothing is left in it that does not
  need a customer.** A3 (`pnpm studio:new`) and A4 (white-label mobile builds) were both done on
  2026-08-09. A1 (per-studio WhatsApp) and A2 (per-studio e-mail sender) are decided and
  deliberately customer-triggered: half of each job is the customer's own Meta account and DNS, so
  building them blind means guessing at the half we cannot see.
- **The next thing is the OPERATIONS gate, not a feature** — external monitoring, a maintenance
  window, a restore rehearsal, and the two money paths that have never run for real. The product
  roadmap's own §1 calls operational readiness a PRECONDITION of selling rather than a comfort, and
  it is the ground the competitor has held for eight years. A second studio (Novozen) has asked;
  nothing is agreed.

---

## What shipped on 2026-08-01 — a long day, four pieces

Panel live at **`build-2026-08-01-008`**. Mobile **1.2.1** uploaded to both stores. All of it is
deployed; none of it needs another push. Read this before assuming something is half-done.

**1 · The freeze initiative (OR-21).** The owner may now freeze a member PAST her allowance — fourteen
days on a seven-day package — deliberately, behind a tick that says what it is about to do. Reception
still sees the plain refusal; only owner/platform_admin may exceed. The freeze records `grantedDays`
(what was approved) and the event carries `overageDays`, present only when the terms were exceeded, so
*"how often, and for whom, do we go past our own terms?"* has an answer. The unfreeze and the nightly
sweep both read the approval, never the budget. Shipped App Hosting + **functions** (the sweep lives
in a function). `098c5f8`.

**2 · The movement guide reached the app, and video plays in place.** Tapping an exercise in the
mobile app opens the panel's guide — target-muscle body diagram, movement summary, correct movement
with photos and cues, common mistakes. Everything it renders was already in the training payload; the
app simply was not showing it. Which muscles to paint is now resolved SERVER-side into
`ExerciseGuide.primaryMuscles/secondaryMuscles`, so a new exercise lights up in both clients with no
app release. Form videos no longer throw her out to YouTube: they play in a popup (iframe on web,
WebView in the app), both built from one shared `youtubeEmbedUrl`. `9a39ecc`.

**3 · Three member states (OR-23).** Aktif · Duraklatılmış · Pasif, all three filters on the members
page with counts. Only *pasif* is stored (it is a decision); the other two are derived from the ledger
at render time, so selling a package moves her to Aktif with nothing to run. The derivation also
checks the DATE, so it never depends on whether the nightly expiry sweep fired. `5b0b5a0`.

**4 · The corrections, which matter more than the features.** Two things were said wrongly and then
fixed — both are written down because a handover that explains a number wrongly is worse than one
that does not explain it:

- 1.2.0 went to both stores with a video player that failed on EVERY exercise. It compiled,
  typechecked, `pnpm check` was green and `next build` was clean. It was found only because the owner
  asked to see it in a simulator. → **OR-22**, and 1.2.1.
- The dashboard's "aktif üye" moving 101 → 105 was attributed to frozen members. There are none. The
  four are members whose package started the NEXT day (three new sales, one renewal bought after the
  old one lapsed). The rule stands; the reason was wrong.

Today's shape: **128 records — 105 aktif · 21 duraklatılmış · 2 pasif.**

### Shipped since, in 1.3.0 (2026-08-03)

Three navigation faults and PF-44. Cüzdanım had no stack entry, so it had no header, no back button
and no tab bar — the member opened her wallet and the app stopped. Üyeliğim was the mirror of it,
passing `header` on a TAB and running under the notch. The training tab derived its own label from
her subscriptions while the screen used the server's answer, so the two could disagree; both read the
server now and it reads "Ölçümlerim". PF-44 put a show-password eye in all six password fields, one
component per platform. **Both navigation fixes were seen in a simulator before upload** (OR-22);
the "Ölçümlerim" label was not — it needs a pilates-only member, so check it on a real account.

Also that day: **recording a class that already happened** (OR-24) — reception adds a walk-in to a
finished class from the attendance panel and the credit is consumed. Web-only; no app change.

### Shipped 2026-08-05 — the desk's day, and measurements that read themselves

Three pieces, in the order they were asked for.

**The dashboard checklist is a to-do list again.** A ticked item used to vanish, so at six o'clock
reception had no idea what she had closed. Done items now stay on the list, struck through, and each
one records **who** closed it (`studios/{sid}/checklistDone/{dayKey}`, `items.{id} = {byName, at}` —
server-only in the rules). Işıl ticking something no longer makes it disappear for whoever opens the
panel next.

**The measurement form asks for what the scale prints.** Kilo · İdeal kilo · Yağsız kütle · Kas ·
Sıvı · Yağ, each in kg AND %, laid out as the printout lays them out. BMI, BMR and visceral left the
FORM but not the RECORD — 56 of the 57 readings taken so far carry them, and a correction still
preserves them.

**And now the form fills itself from the scale's PDF** (OR-27). Reception uploads the Tanita printout,
the model reads the numbers off it, the fields are pre-filled, and **a human still presses Kaydet**.
Unreadable, or not a scale printout at all → "PDF okunamadı", manual fields underneath, nothing saved.
Verified against the live API before shipping (OR-22): a synthetic RD-545 sheet returned all thirteen
fields correctly, ignoring the parenthesised normal ranges — the trap that would otherwise record
`53.09` as an ideal weight of `59.41` — and an invoice PDF was refused rather than mined for numbers.
Round trip ≈ 9 s, so the button says "Okunuyor…" and gives up at 45.

Two things to know about it. **The PDF is never stored** — read once, discarded; it is a data source,
not an attachment. And this is the **only** AI call in the product that carries a member's name: a
printout cannot be tokenised before it is read. OR-27 states the trade and what to do if it stops
being acceptable.

The member sees a **"Son iki ölçüm arası"** summary — in the app and in the portal, from one shared
function (`compareMeasurements` in `@studio/core/client`), computed from the stored readings rather
than the PDF, so it works for every reading taken before PDFs existed. It carries **no verdict**, on
purpose: see OR-27.

Model note: this call uses `claude-opus-5`, not the Haiku the daily briefing uses. A misread digit
lands in a member's record, and the volume is a handful of readings a week.

**Verified against a real RD-545 printout the same evening.** Three findings worth keeping:

- **The sheet has no usable text layer.** Three pages, 146 embedded images, subset fonts — plain text
  extraction returns nothing readable. A regex parser would have scored zero on this file; the model
  reads it visually. That is the reason there is no PDF library in `apps/web`, and the reason to be
  sceptical of any future "just parse the text" simplification.
- **The multi-row trap is real and it is handled.** Page 3 is a full history table (three dated
  readings) and page 2 prints score pairs as `E | S`. The parser took the newest row and the `S` side
  every time. Both rules are now written into the prompt explicitly rather than being got right by
  luck.
- **`Bel (cm)` was on the sheet while Çevre ölçüleri sat empty**, so the waist is now filled in too —
  an existing `Bel` row is updated, never duplicated, and the ratios beside it (`Bel/Kalça 0.78`,
  `Bel/Boy 0.45`) are refused by a 30–250 cm band so `Bel 0.78 cm` can never reach a record.

Three consecutive runs over the same file returned byte-identical output.

**The sheet also carries the member's PREVIOUS readings** (`Fark Analizi`, dated rows). Backfilling
history from them is possible and was deliberately NOT built — nobody asked, the rows carry only four
of the fields, and inventing dated measurements nobody entered is the sort of thing that is hard to
unpick later. It is an option, not a plan.

### Shipped late on 2026-08-05 — Sanal POS, and online sales get a human step

**Sanal POS was broken for every member without an e-mail address, and had been.** The PAYTR token is
an HMAC over fields we also post; the hash signed `''` while the body carried a placeholder, so PAYTR
could not verify it. Confirmed against the live endpoint, fixed, and covered by a test that recomputes
PAYTR's hash from the body actually posted — so a mismatch in *any* field fails, not just this one.
`debug_on` is now always on: with it off, a rejected token comes back as a **zero-byte body**, which is
why the error read `paytr_token_failed` and told nobody anything. See OR-28.

**Online membership sales already existed** — `/uyelik?s=retro`, a public page with the price list, a
KVKK-consented buyer form, rate limiting and PAYTR. What changed is the ending. The callback used to
find-or-create the buyer and grant the package unattended; now it stops at paid and **reception creates
the membership** from a card on the dashboard (OR-29). One press attaches the money, grants the package
and sends the invite. A phone already on the books is shown as a named suggestion, never merged.

The marketing site is done too, and it was never out of reach — it lives at `~/pilates-site` (see the
address list at the top). `uyelik.html` already listed every online package with a Satın Al button;
what was missing was the homepage, where the four package cards offered only "Bilgi al" on WhatsApp.
Each card now offers both, and the buy button carries the **card-inclusive** total read live from
`/api/public/products` — the price printed on the card is the studio's CASH list and is deliberately
lower, so sending someone from a ₺8.000 card to a ₺9.000 checkout would have been a nasty little
surprise. A package that stops being sold online loses its button by itself, with nothing to deploy.

**The site also had to stop promising "üyeliğin anında aktif".** It is not, any more — reception
creates it (OR-29). Every instance on both pages now says the payment is taken and reception creates
the membership. If that human step is ever removed, these lines have to move back with it.

⚠️ **This one needs BOTH deploys.** PAYTR calls the Cloud Function (OR-16), so `firebase deploy --only
functions` is what actually changes what happens after a payment; App Hosting alone only changes the
panel.

### 2026-08-06 — the late-cancel incident

A member late-cancelled the same class twice in fifty-one seconds from her phone and lost two credits.
She rang the studio. **The audit is closed and it is small: those two are the ONLY late cancellations
in the system's entire history**, both hers, both today, both self-service — no other member has ever
been charged this way. Her two credits were restored through the panel's own adjustment path
(`reason: correction`, note recorded, landing in `restored`, never `granted`); her ledger now reads
8 granted − 1 attended − 1 held for her 7 Aug booking = **6 available**, which is correct.

The rule changed with it — see OR-30. A member can no longer cancel inside the window at all, the
refusal lives in the domain rather than in a hidden button, and no member surface says "geç iptal"
any more.

### 2026-08-06 — the member app's new design language, and one price

**Mobile.** The app moved to "Stüdyo Editoryal" — the marketing site's own bone paper, mahogany ink
and Georgia, so the app and the website stop looking like two businesses. Screens kept their layouts
(OR-6's discipline applied to mobile); what changed is material. Four tabs: **Bugün · Ajanda ·
Antrenman|Ölçümlerim · Ben**. The third tab's NAME comes from the server (`TrainingBundle.
showPrograms`) — a pilates-only member never meets the word "Antrenman", not as a label and not as an
empty state. Üyeliğim, Cüzdan, Mesajlar and Profil merged into **Ben**; QR moved to each screen's
top-right.

Two things learned the hard way and worth not repeating: a word-only tab bar (no icons) reads as a
caption strip and was rejected twice; and a fixed `height` on `tabBarStyle` overrides the safe-area
inset, which pushes labels onto the home indicator. Bugün now drops any module with nothing to report
— the empty attendance card and the "∞ kalan hakkın" figure are gone — and shows the studio's next
open day as four lines of timetable instead.

**These mobile changes are NOT in members' hands.** They need a store release (1.4.0), which also
carries OR-30's cancel block.

**One price (OR-31).** The cash/card split is over: every package is one number in cash, by transfer
and on the card, and PAYTR is sent that number. The KK/havale farkı mechanism stays, zeroed to `0` in
every category — visible in Ayarlar › Ödeme and one number away from returning. Written to production
by `pnpm setup:single-price` (each change a `product.updated` event): Pilates 8 Ders ₺5.000 · Fitness
3/6/12 Aylık ₺9.000/₺14.000/₺22.000, with 12 Aylık newly created; **Pilates 16 and 24 Ders are
deactivated** — not sold, no price shown. The four hybrid bundles were re-derived from the same two
anchors (a pilates lesson ₺625, a fitness entry ₺400) rather than simply raised: ₺4.500 · ₺5.500 ·
₺6.500 · ₺18.000. Untouched, and therefore still on the OLD arithmetic: Fitness 1/2 Aylık, Reformer
4 Ders, PT 8 Ders.

**Nothing reached an existing member.** An entitlement freezes its `productSnapshot` at purchase, so
repricing the catalogue cannot rewrite a right already sold — no migration, no reconciliation, and
nothing to tell members about their current packages.

Live already: prices (data, so every surface that reads the catalogue is correct now), the marketing
site, and the WhatsApp AI (functions deployed — it now prints one figure and refuses to invent an
instalment rate). **Waiting on the night deploy: the panel/portal copy** (App Hosting). The mobile
buy screen's new footnote rides with 1.4.0.

### 2026-08-06 (evening) — one price, discounts, and the workout log

**Tek fiyat (OR-31) shipped in full.** Catalogue, marketing site, panel/portal copy and the WhatsApp
AI are all live. The AI's `policies` field had been TEACHING the old model in prose ("nakit fiyata
1.000 TL eklenir", "3 taksitte banka %10 alır") — a correct live price plus an instruction to add a
surcharge to it. Rewritten. The four hybrid bundles were re-derived from two anchors rather than
raised: a pilates lesson ₺625, a fitness entry ₺400 (so ten entries = one unlimited month, which
makes the boundary explain itself).

**İndirim (OR-32).** A price the studio comes down to is now a discount, not a debt. Owner-only,
enforced in the Server Action; reason optional (`manual` still needs a note — I-36); the line keeps
the LIST price so "we came down" never collapses into "we sold something cheaper". History was
audited first: five open balances, none a disguised discount, zero discounts in the system ever.

**Antrenman takibi (OR-33).** The member ticks each exercise, records sets/reps/weight and a note,
and finishes the day; the cycle is walked in order with the refusal in the DOMAIN. Her declaration
is never added to the door's observation — they meet only on the staff adherence view, where the GAP
is the signal.

**Two bugs found by fixing a type.** `/fitness` had been typed as core's `MemberFitness` while the
endpoint returns `{ stats, recent }`: every read was `undefined`, so "Son 30 gün" on Bugün and the
streak line on Ben had never rendered and nothing said so. And the home progress line picked "the
first active programme" when a member can hold several — it now follows the one she trained most
recently. **When a member-facing number never appears, suspect the type before the data.**

**Data corrected in production:** Program B's template had day names that disagreed with their order
(`order:1` was called "2. Gün"), which made a correct cycle look broken. 149 programmes audited, 1
affected, fixed at the template and the programme. Names were moved onto their order, never the
reverse — renumbering would have re-labelled work already done.

### Shipped 2026-08-07 — the discount reaches the desk's real case, and a door gets built

**İndirim after the sale, not only during it (OR-32 extended).** Yesterday's discount lived at the
point of sale, and within a day the desk hit the case it could not reach: reception sells at list,
takes what the member brought, and the rest is agreed away afterwards. A ₺5.000 package with ₺4.200
collected sat at ₺800 *debt* — money the member does not owe, on the owner's collection list. Üye ›
Paket › Düzenle now offers **İndirim Uygula** beside Tahsilat Al: the sale keeps its gross, gains a
discount, and settles. Editing the agreed price down would close the balance too, but it destroys
what the package costs and the fact that anything was given away — **a studio that cannot count what
it discounted cannot decide whether to keep doing it.** A discount larger than what is still OWED is
refused, never clamped: forgiving money already in the till is a *refund*, a different act with cash
going back. Owner-only; `manual` still needs a note (I-36); the event carries `totalBefore`/
`totalAfter` so revenue can be corrected from the log alone.

**The turnstile (OR-34).** A Perkotek S150 — dry contact, no reader, no network, no opinion. A screen
beside the arm shows a six-digit code; the member scans it with her phone; we answer from her
packages, her freeze and her balance. The code lives 45 seconds, is bound to its device, and is
single-use **spent in a transaction** — single use IS the race, and read-then-write would let two
phones pointed at the same screen both in. The code is spent BEFORE the check-in is recorded, so a
race fails as "the door did not open" rather than "two people crossed on one code".

It emits `member.checked_in` with `method: 'device'` — the field has sat unused since the first
commit waiting for exactly this (AD-18), so occupancy keeps one arithmetic and one debounce. The
device is a principal with its own id and secret; only the secret's SHA-256 is stored. The full rule
is OR-34. **`pnpm setup:turnstile` pairs a device and prints the secret ONCE** — there is
deliberately no way to read it back; lose it and you mint a new one and deactivate the old device.

One fault, caught by probing the live endpoint after deploying: `POST /api/turnstile` answered **307,
not 401**. The coarse cookie gate treated it as a panel page and bounced it to `/login`. A box bolted
to a wall has no `__session` cookie, cannot follow a redirect, and would never report one — so the
arm would have stopped opening with nothing anywhere saying why. The exemption went in **as a test**,
not as a line someone can quietly delete. *This is what "probe the live endpoint after deploying"
buys, and it is the second time it has paid (OR-22).*

### Shipped 2026-08-08 — a rule enforced on the way in, and a panel that can be photographed

**A pilates-only member cannot be given a workout programme (OR-35).** The rule was settled on
2026-08-06 and it shaped the member app — but it was only ever enforced where the data is
**displayed**. The app hid the tab while the panel happily assigned a programme anyway, and one was,
to a member holding a single Reformer package. **A rule that lives only on the read side is not a
rule; it is a preference the next screen ignores.** One function (`mayHaveProgram`) now answers it
and both sides call it; the two doors that create a programme refuse, and the panel hides the buttons
*and says why* — a button that is merely absent is a button a second screen still presses. A member
who already HAS a programme keeps it: nothing granted is taken away by a rule written afterwards.

The audit matters more than the fix. Six programmes had no fitness/PT package behind them and only
**two** were this bug — four belonged to fitness members whose package had EXPIRED, and their
programme must be waiting for them when they renew. Archiving those would have looked like tidying
and been a small act of vandalism. The two real ones were **archived, never deleted**: deleting
erases the evidence of the bug being fixed.

**Demo mode.** The platform's marketing screenshots and a second studio's live demo both need the
panel open — with forty women's names, phone numbers and gym times on screen. Names become "Ayşe K.",
phones `+90 5•• ••• •• 47`, and **every number, date, occupancy and amount stays real**: a demo
convinces because it moves like a real business, not because the figures were invented.

Three properties, each deliberate. It **writes nothing** — not to Firestore, not to the event log,
not to studio settings, so turning it off is easier than turning it on. It lives in a **cookie, not
settings**, so the owner enabling it does not mask reception's screen — how the panel looks belongs
to a person, not a studio. And the masking happens on the **server**: sending the real name and
blurring it in CSS is not masking, it is a screenshot that still carries every name in the page
source. Pseudonyms are deterministic, so one member is the same "Ayşe K." on the calendar and in the
member list; the surname is dropped rather than kept as an initial, because in a studio this size
"S. G." is a short list.

It missed one screen, caught in a screenshot the owner had already taken: the **Stüdyodan öneriler**
list still carried real names, and beside each one "23 gündür gelmiyor" — that screen alone would
have published both who the members are and which of them are drifting away. Fixed the same evening.
**A demo mode that works on most screens is not a demo mode, and the screen it misses is the one that
ends up in a screenshot, because nobody re-checks a feature they have already seen working.**

**Demo mode is finished — nothing is outstanding on it.**

### 2026-08-09 — the invite template, and a channel that had been dead without saying so

**`uyelik_daveti_v2` is approved and the code now uses it.** v1 had one placeholder, so the invite
link and the login address had to be crammed into it on a single line (Meta rejects a parameter
containing a newline). v2 prints the login address as static text, so the parameter is the invite
link again.

**The switch repaired something nobody had reported.** Two places send that invitation, and only one
of them built the crammed value: the web tier did, and the **PAYTR callback function** — the one
that actually runs after an online purchase (OR-16) — built `inviteLink` and `loginLink` and never
the combined key. So its WhatsApp invitation went to Meta with an empty parameter and was refused,
while the in-app copy arrived and made the send look fine. The member who had just paid got a
notification in an app she had not installed yet.

The test that guarded this checked the parameter's NAME. It now checks the property that actually
matters: **every key the WhatsApp mapping asks for must be one that every sender builds.** A
parameter only some senders populate is the defect; which key it happened to be never was.

⚠️ **This needed BOTH deploys** — the mapping lives in `packages/core`, and the sender that was broken
is a Cloud Function. App Hosting alone would have changed the panel and left the online-purchase
invitation exactly as broken as it was. **Both went out the same evening**: panel
`build-2026-08-09-007` (100% traffic) and all eleven functions at 16:00–16:01 UTC. Verified after,
not assumed — Cloud Run's traffic split (OR-17), the login page, and `/api/public/products?s=retro`
returning the live price list.

**A near-identical competitor domain surfaced the same day: `studioasistan.com`** — same sector, one
letter apart, and nobody had checked for it when the name was chosen. Neither name is registered at
TÜRKPATENT. The whole picture, and what it means for the trademark, is in `PRODUCT-ROADMAP.md` §9.

---

### 2026-08-10 — the discount that was applied and never shown

The owner opened a settled package and asked where the İndirim button had gone. It had not gone
anywhere: the block is gated on `due > 0`, the debt was already closed by a discount, and a debt
that does not exist cannot be discounted. **The button was right; the screen above it was not.**

"Paket tutarı 5.000 · Tahsil edilen 4.200 · Kalan borç —" — every number correct, and together
nonsense. The first comes from the ENTITLEMENT's own price, which is before any discount; the other
two come from the SALE, which is after it. The 800 that bridges them lived in an event and on the
sale and was printed nowhere, so a settled package read as one whose debt had gone missing.

That is the feature failing on its own terms: it exists because a studio that cannot count what it
discounted cannot decide whether to keep doing it (OR-32), and not one of them was visible on the
screen where the money is. `EntitlementMoney` now carries the sale's discount and the row renders
when there is one.

**Two things worth keeping from the diagnosis.** The feature is in ACTIVE use — several
`sale.discounted` events exist (5.000→4.200, 9.000→8.000, 5.500→5.000), so this was a reporting gap
and never a broken write. And the question was answered from the event log and the code, not from
the screenshot: the screenshot is what raised it, and it could not have said which of the three
numbers was lying.

---

### 2026-08-10 (evening) — the panel wears the studio's name, the login wears ours

The sidebar read "Studio · Yönetim Asistanı" — a name that by then belonged to nobody: not the
customer, and not the platform after the rename. It now reads the studio's own name from
`settings/studio` (`getStudioName`), with the avatar initial derived from that same string so the
two can never disagree. Işıl's panel says **Pilates Fitness By Işıl · Yönetim Paneli**.

This is the white-label decision applied where it actually shows (PRODUCT-ROADMAP §9): a product
whose chrome advertises its supplier is not white-label. The theme already worked this way — her
panel takes its colour from her own settings — and the name was the last thing that did not.

**The login screen goes the other way, deliberately.** No session yet ⇒ no studio to name, which
makes it the one panel screen legitimately ours. It says **RetroAsistan · Stüdyo Yönetim Sistemi**.
The rule reads cleanly in both directions: before sign-in it is our product, after sign-in it is
hers.

**And a false green, walked into rather than avoided.** Four pushes went out in a row and the
rollout was watched for "the revision id changed" — which fired on the PREVIOUS docs commit's
build. The panel was reported live when it was not; only the page's `no-store` header and its
still-old content gave it away. Cloud Run's traffic split answers *did a deploy land*, not *did MY
deploy land*, and with pushes stacked those are different questions. Now in `docs/RUNBOOK.md`:
with pushes stacked, wait for the CHANGE, not for a number to move.

Live at `build-2026-08-10-004`, both changes verified on the page itself.

---

### 2026-08-13 — a payment on a dead sale, and a date that walked backwards

**The reported problem was the smaller one.** A member paid ₺5.000 by link and still showed as
owing ₺5.000. Nothing had failed: reception had cancelled her packages at 10:14 and re-sold the same
hybrid at 10:15, and **cancelling a package does not cancel its sale** — so an orphan open sale sat
there, older than the real one, and `collect` clears debt oldest-first. Now OR-37: money never
settles against a sale whose packages are all cancelled. The root cause runs deeper than the
allocation order: a payment link never records WHICH sale it was created for (`saleId` on the intent
is synthesised from the provider ref in five places), so the callback guesses. **The fix is not
built yet — the owner is choosing between binding the link to its sale and skipping dead sales.**

**What the diagnosis turned up is worse.** Editing a package moved its start date back one day, every
save, silently. The write stores studio-local midnight (`<date>T00:00:00Z − 3h`) and the dialog read
it back with `toISOString()` — three hours earlier, the PREVIOUS day. The input showed a date one
behind the truth and saving wrote that back, so **the damage compounds with care**: the more often
somebody opens a package to check it, the further its dates drift. The correct line was already in
the same file, one line below, in `studioToday`.

**Audit (2026-08-14): 8 entitlements, 15 days, 6 members.** Çağla Kökener −4 · Buse Ertaş −3 (both
hybrid halves) · Gülcan Ayvaz, İrem Kılıç, Şule Gürses, Gamze Baykaldı −1 each. Corrected by hand
from the panel after the fix deployed, using **current date + days lost** rather than the
first-observed value — Şule's package had a later, deliberate date change that the naive restore
would have undone. Gamze's expired in June and was left alone.

`joinedAt` on the member form had the identical defect and was fixed with it, but the audit shows it
never fired: 15 profile updates, none of them touching that field.

**A wider audit followed, and it came back clean.** Every package's span was compared against its
product's duration: **147 of 163 match exactly.** Of the 16 that do not, eleven are migration records
(imported 23–31 July with the old system's real dates — a member arriving mid-package is OR-9's
normal case, not a fault), one is a freeze that extended the end by exactly the seven days used, and
one is a package deliberately made passive with a new one opened in its place.

Two remain unexplained and both are recent hand-entered sales: **Ebru Yıldız and Sezen Sarı, +7 days
each.** Possibly goodwill; the same seven days twice is worth a look rather than an assumption.

Two things to know before running this audit again. The convention is `validUntil = validFrom +
durationDays` — counting both ends makes every one of the 163 look wrong, which is how the first run
came back with 163 false positives. And **"Pasife Al" pulls `validUntil` back to today**, so a
deliberately-ended package will always read as short. Neither is a defect.

**Two smaller faults, same morning.** The five money dialogs reported "Kaydedilemedi." for a thrown
error, hiding the stale-tab cause the desk could actually act on (the helper existed and was used
elsewhere in the same file). And the package-edit dialog holds a collection sub-form with its own
button: typing an amount there and pressing the dialog's own **Kaydet** saves the amendment and
silently discards the payment — which is what happened, twice.

---

### 2026-08-18 — the Fitness campaign, and a second price the model could not express

**The advert went live before the software could describe it.** The poster prices the three fitness
packages twice — 8.500 / 12.750 / 19.500 in cash, 9.500 / 14.000 / 22.000 on the card — and the gaps
are ₺1.000, ₺1.250 and ₺2.500. As a percentage they are 11,8 / 9,8 / 12,8. The KK farkı mechanism
carries **one rule per category**, either a percent or a fixed amount, so it can express neither.

So a product may now carry its own cash price. `product.cashPriceInKurus` is null by default and the
old behaviour is exactly the null case; when it is set, `priceInKurus` is the **card** price and the
new field is the cash one. `productPrices(product, cfg)` in `packages/core/src/shared/pricing.ts` is
the only function that knows which arrangement applies, and it returns `{ cashKurus, cardExtraKurus,
cardKurus }` with `cash + extra = card` in both — asserted in `pricing.test.ts`. Every surface was
moved onto it in the same commit: the desk sale form, the mobile app's buy screen, `/api/public/
products` (which now sends `cashKurus` too), the marketing site, and the WhatsApp assistant.

**The trap this avoided.** The desk sale form pre-filled `product.priceInKurus`. The card prices had
already been written to production the day before, so on the morning the campaign started every cash
sale of a fitness package would have been recorded at the card price — ₺1.000 too much on the
smallest one, and nobody would have noticed until a member argued about it. The form now pre-fills
the cash figure and adds the difference back for a non-cash method. A reception override still takes
the category rule, not the campaign gap: a hand-typed number is a negotiated cash amount, not a new
campaign.

**The assistant sells now, and what it says is data.** Ayarlar › AI Ayarları grew a **Güncel
kampanya** box: free text, owner-editable, injected into the cached half of the system prompt. It
carries no prices — the assistant already reads the live catalogue, and a number repeated there would
go stale the day the owner edits the first. It carries the *instructions*: lead with 12 Aylık, name
the peşin fiyatına 3 taksit (the studio absorbs that vade farkı; 3 and 6 Aylık go to six instalments
with the payment institution's), say capacity is limited **once** without pressure, and offer remote
registration. The prompt gained a step 3.5 — give the price, then ask for the decision — and the live
facts gained a two-price paragraph and a remote-registration line that only appears while a payment
provider is actually active and links are enabled. The assistant offers the link and hands over; it
cannot mint one, and it is told not to promise and leave someone waiting.

**Also written to production:** cash prices on the three products, and the campaign note
(`tools/migration/campaign-2026-08-cash-prices.ts`, dry-run first). The card prices and the
instalment cap 3 → 6 had gone in the day before. Rule recorded as OR-38; OR-31's "one price" still
holds for pilates, hybrid and PT.

**All three deployed the same afternoon** — the owner chose to ship rather than wait for the night
(OR-24), because reception could otherwise have taken a cash sale at the card price. The marketing
site went first, then the WhatsApp function, then the panel; reception was told to reload.

**The 12-month interest-free instalments are configured in the PAYTR merchant panel and confirmed
live by the owner (2026-08-18).** That setting is outside this repository and nothing here can check
it — see OR-38 for why that matters when the campaign ends.

### 2026-08-18 (akşam) — the contract set, and a build that had been failing silently

**TAMI would not advance the merchant application** until the site carried four things: a domestic
address with a telephone, a privacy policy, cancellation terms and a distance-sales contract. Those
were the day's critical path. What they require underneath turned out to be larger, and most of it
was built: `/iletisim`, `/kvkk`, `/iptal-iade`, `/mesafeli-satis`, `/on-bilgilendirme`,
`/acik-riza-saglik`, all public, all on one shell, all linked from every page of the marketing site's
footer along with the seller's identity. `/gizlilik` stopped carrying a personal Gmail address as the
data controller's contact.

**The contract is generated for the package.** `?s=&p=` reads the same public catalogue action the
sales page and the marketing site read, so the figure printed in the Mesafeli Satış Sözleşmesi is the
figure PayTR will charge. Verified live against two products before the reply went to TAMI.

**Checkout now refuses without consent, server-side.** Three mandatory boxes (KVKK · ÖBF+MSS · the
14-day early-start acknowledgement), none pre-ticked, each link opening in a new tab so reading a
contract does not empty the form. Marketing consent is separate, optional, labelled *İsteğe bağlı*,
and flips `notificationPrefs.campaign` — the flag the notification domain actually consults.

**Consents name their version.** `LEGAL_DOCS[…].version` in `apps/web/src/lib/legal.ts`, stamped onto
the payment intent at acceptance and copied to the member as `legalConsents` at fulfilment. The audit
that preceded this found the existing `kvkkConsentAt` died on the intent and was unqueryable from the
member it belonged to. **Bumping a version is a legal act** — change the text and the version in one
commit, and never edit a version's text after somebody has accepted it.

**Every claim was checked against the code before it was written down.** There is no TC kimlik field,
no address field and no accounting integration, so the KVKK notice claims none of them; the
cancellation window is stated as the 6 hours the software enforces, not the 12/6 split the brief
asked for, which would need a domain change (owner chose the text match — OR-38's neighbour).

**The build had been failing since 11:25 UTC and nobody knew.** `SEGMENT_LABEL`/`SEGMENT_KEYS` were
exported from a `'use server'` file, which may export async functions and nothing else. `pnpm check`
does not run `next build` (OR-15), so the gate stayed green while App Hosting rejected every push —
including the notification-segment fix those constants had been added for. Moved to
`apps/web/src/lib/segments.ts`. **Run `pnpm --filter web build` before pushing anything that touches a
`'use server'` file**; it is the only thing that catches this class.

**The app announcement went out**: 124 members, WhatsApp + in-app, 248 delivery attempts, zero errors
(`cor_01M0AK8EP7FQ2N3BQEZVCT6AK7`). The earlier failures were the broken build plus a stale tab —
"Kaydedilemedi" is what a dead Server Action id looks like from the UI, and the logs said so
outright.

**Not built, and each one is a real gap rather than a nicety:**

1. **No purchase e-mail with the details.** `package_created` and `payment_received` fire, but the
   template carries no amount, date, duration or contract copy — §19 of the brief.
2. **The contract TEXT is not snapshotted**, only its version. Proof holds exactly as long as nobody
   edits a version in place.
3. **Health data is still collected with no consent gate.** `/acik-riza-saglik` exists and
   `gizlilik` has always promised açık rıza, but `server/actions/training.ts` checks role only. This
   is the one gap where the published policy and the code disagree.
4. **İYS** — no integration, no entegrasyon noktası yet.
5. **Reception's own sales take none of these consents** — only the online checkout does.
6. **Kamera bilgilendirme levhası** at the physical entrance — the owner's task, not code.

### 2026-08-19 — TAMI: everything works except the one thing TAMI has to turn on

The merchant account was approved this morning. By the end of the day both providers are wired, the
owner picks one in Ayarlar, and every payment path reads that choice. TAMI is **not** live: its
hosted payment page is not provisioned for this merchant, which is a switch on their side.

**What was built.** Three secrets into Secret Manager (`TAMI_SECRET_KEY`, `TAMI_JWK_K`,
`TAMI_JWK_KID`); the settings action stopped forcing `provider: 'paytr'`; five intent-creation sites
stopped hard-coding it too; and `/api/payments/tami/return` was written, because TAMI has no
callback. It redirects the buyer's browser back and tells us nothing — so the return endpoint grants
nothing on arrival and instead asks TAMI, over a JWK-signed query, whether the order was paid.
Everything after the verdict is the same `completePaidIntent` PayTR completes through.

**Where it stands.** `POST /hosted/create-one-time-hosted-token` answers **200 with a valid
oneTimeToken** in production. Opening `portal.tami.com.tr/hostedPaymentPage?token=…` renders
**"Sayfa Bulunamadı"**. The POS Yönetimi screen offers only an **API** terminal — "Ortak Ödeme
Sayfası" is not in the list. So the API mints a token and nothing is provisioned to display it.
Mailed to Aybars Bey with the evidence, plus two standing questions: a sample SUCCESSFUL
`/payment/query` response (the field names are still unobserved, so `confirm()` refuses rather than
guesses), and how interest-free instalments are defined on their side.

**Test mode cannot be used at all.** Production credentials against `sandbox-paymentapi.tami.com.tr`
answer `errorCode 4003`. The merchant panel issues production keys only; sandbox needs its own. So
TAMI testing happens in production, with small amounts.

**Provider is back on PAYTR** and verified end to end afterwards — a real ₺10 link payment: intent
`paid`, collection `pcol_01M0D672…` written `unreconciled`. That test existed because five payment
code paths were edited today and compiling is not the same as working. TAMI's merchant/terminal
numbers survive in settings, so switching back is one dropdown.

### The four silences that cost the afternoon

None of the day's real delays were the integration. They were places where something failed and
**nothing said so** — worth reading as a group, because the pattern repeats.

1. **`<Toaster />` is mounted only in the (staff) layout.** `/pay` and `/uyelik` live outside it, so
   every `toast.error` on the two CUSTOMER-facing payment pages had been called and rendered nowhere
   for as long as those pages existed. A buyer whose checkout was refused saw a page that did
   nothing. Fixed; it is what finally showed the real error.
2. **A refused checkout logged nothing server-side**, and the TAMI adapter reduced the answer to
   `tami_http_400`, discarding a body that said `errorCode 4003`. Both now carry the provider's own
   words.
3. **`settings.successUrl` pointed at `/payments/return`, a page that has never existed.** Every
   member who paid for a package by card was redirected there and got a 307 to the STAFF LOGIN.
   Live on PayTR the whole time; surfaced only because TAMI reuses the same field. Cleared — the
   code already falls back to `/portal`.
4. **The way in was a button labelled "PAYTR Bağlantısı"**, so the owner could not find the TAMI
   settings: the door named one of the two things behind it.

**And one I caused.** Three "it still does nothing" reports were stale Server Action ids — because I
kept deploying while he was testing. Each reload was invalidated by my next rollout. Freeze
deployments during a live test; the fix for the general case is item 1 of the list below.

### ⚠️ App Hosting: a failed rollout stops auto-deploying pushes

Two pushes after the first failed rollout produced **no build at all**, and the most-recent-build
query kept returning the old failure — so it looked like the same error repeating. It was not:
nothing was running. `firebase apphosting:rollouts:create studio-yonetim --git-branch main` starts
one explicitly.

The first failure itself was `fah/misconfigured-secret`: a new secret needs the App Hosting backend
granted access **before** the rollout, which is a separate step from creating it
(`firebase apphosting:secrets:grantaccess <NAME> --backend studio-yonetim`).

**So OR-17 needs a step in front of it.** "Did it deploy?" is answered by the traffic split — but
before that, "did a build even start?" is answered by a NEW build appearing. Checking the latest
build's status alone will happily report a stale failure forever.

### Sırada (TAMI)

1. Aybars Bey'in cevabı — Ortak Ödeme Sayfası tanımı
2. Cevap gelince: Ayarlar → sağlayıcı TAMI → küçük tutarlı gerçek ödeme
3. İlk başarılı ödemede `/payment/query` yanıtını logdan oku ve `tami-provider.ts`'teki alan
   adlarını kesinleştir — şu an tahmin edilen kısım orası, ve "emin değilsem ödenmemiş say" diyor
4. "Bağlantıyı Test Et" kaydedilmemiş değişiklik varken uyarsın (bugün kafa karıştırdı)

### 2026-08-26 — Turnike: ekran, QR ve geçiş çalışıyor; röle 5 volt bekliyor

Firmware `apps/turnstile/` (PlatformIO, pnpm workspace'inin dışında — `pnpm check` oraya bakmaz).
Derleme/yükleme: `~/Library/Python/3.9/bin/pio run -t upload --upload-port /dev/cu.usbmodem…`

**ÇALIŞAN, uçtan uca doğrulanmış:** ekran (ILI9341, 2 MHz) · WiFi · sunucudan kod alma · ekranda QR ·
telefonla okutma · sunucunun geçişi kaydetmesi · cihazın geçişi görüp **"Hoş geldin YUNUS"** yazması.

**Kalan tek şey: röleye gerçek 5 volt.** Polarite **aktif-LOW** olarak kanıtlandı (pini toprağa
çekince `DS1` yanıyor). Bobin 3.3 V'ta çekmiyor — LED yanıyor, kontak kapanmıyor.

⚠️ **Kartın `5Vin` pini bir GİRİŞ, çıkış değil.** Oradan gerilim alınmıyor (röle bağlanınca `DS1`
hiç yanmadı; 3V3'e alınınca yandı). Yani ESP32'nin pininden röle beslenemez. Çözüm: adaptör 5 V'u
**klemensle ikiye ayrılıp** hem `5Vin`e hem röle `Vcc`sine gidecek. Owner **USB dişi klemens**
sipariş edecek.

**DONANIM — acı çekerek öğrenilenler:**
- Kart **YD-ESP32-S3** (klon), **pin şeritleri lehimsiz geliyordu.** Bir akşamın tamamı buna gitti:
  temas tesadüfe kalmış, elle bastırınca değişen bir arıza. Lehimletildi, sonra ilk denemede çalıştı.
- Ekran **LockerBox 3.2" ILI9341, 3.3 V** (regülatörü yok, 5 V yakar). `J1` açık olduğu için arka
  ışığı `LED` pini sürüyor — **GPIO'ya bağlanmalı**, 3V3'e değil.
- `ARDUINO_USB_CDC_ON_BOOT=0` olmalı: 1 yapılırsa `Serial` kartın DİĞER USB portuna gider ve
  UART'tan bakan hiçbir şey göremez.
- **Pin haritası:** SCK 12 · MOSI 11 · DC 13 · RST 8 · CS 10 · LED(arka ışık) 18 · röle IN1/IN2 5/4
  (IN1 geçici olarak 18'e alınmıştı, geri konacak).

**SUNUCU — bugün iki şey değişti:**
1. **Çift okuma koruması turnikede hiç çalışmıyormuş** (`a5da017`). Kural "yön açıkça istenmediyse
   45 sn içinde ikinciyi reddet" diyor; turnike her geçişte yön gönderdiği için muafiyeti her
   seferinde alıyordu — oysa turnikenin yönü istek değil, ÇIKARIM. Ekran 8 sn'de bir yeni kod
   ürettiği için kamerayı açık tutan üye giriyor ve hemen çıkıyordu. Owner on dakikada buldu.
   Süre **45 sn'de bırakıldı** (owner kararı).
2. **Cihaz artık tarafını beyan ediyor** (`9c71d4b`, `TurnstileDevice.side`). Yön sırası: kolun
   raporu → ekranın tarafı → mevcut durum. Eskiden ortadaki yoktu ve çıkışta okutmayı zorunlu
   kılmanın anlamı kayboluyordu: sistemin "içeride" sandığı üye giriş ekranını okutunca **çıkış**
   kaydediliyordu.

**Cihaz:** `dev_8f0a11df8e7e81885000`, adı `polis`, taraf `in`, şube `mutlukent`. Sırrı
`apps/turnstile/src/secrets.h` içinde — **git'in görmediği dosya**, kopyası yok.

**Panelde cihaz ekleme ekranı YOK.** İlk cihaz elle oluşturuldu; ikinci ekran için ikincisi de
gerekecek. `listTurnstilesAction` var ama onu kullanan bir ekran yok.

**Sırada:** klemens gelince röle (Aşama 3 kapanır) → ikinci ekran + ikinci cihaz (Aşama 4) →
turnikeye montaj (Aşama 5: `F01=5 F02=0 F03=0 F04=0`, ve `COM`u `OP-R`ye değdirip hangi yönün
açıldığının **denenmesi** — şemadaki oklar çelişkili).

---

### 2026-08-24/25 — TAMI canlıya hazır, ödeme başına sağlayıcı, ve mobil 1.7.0

Uzun bir gün; sırayla ne olduğu ve **hangi hatanın nasıl bulunduğu**.

#### TAMI — ortak ödeme sayfası açıldı, ve dört tuzak çıktı

Aylardır beklenen ürün tanımlandı. Kod zaten dokümana göre yazılmıştı; asıl iş **gerçek parayla
doğrulamak** oldu, ve tahminle canlıya çıksaydık dördü de sessizce yanlış çalışacaktı.

**Doğrulananlar:** prod token üretimi (HTTP 200) · gerçek **₺1 ödeme** (Garanti, Mastercard, 3D) ·
sorgu · **gerçek iade**. Komisyon %2,85, valör 1 gün. JWK zaten yerindeydi — cevabın kendi
`securityHash`'i bizim `kid`'imizle imzalı geldi, doğruluğunun kanıtı bu.

1. **Alan adları uydurmaymış.** Adaptör `transactionStatus`/`status` arıyordu; TAMI
   **`paymentStatus`** ve **`orderStatus`** gönderiyor. Alan bulunamayınca kod "ödendi" varsayıyordu
   — yani **tesadüfen doğru** çalışıyordu. Testler de aynı uydurma alanı doğruluyordu: kod ve testler
   birbiriyle anlaşıyor, ikisi de TAMI ile anlaşmıyordu. Artık **beyaz liste**.
2. **İade edilmiş ödeme hâlâ "SUCCESS" diyor.** ₺1'i geri alıp tekrar sorunca:
   `orderStatus AUTH → REVERSE`, ama **`paymentStatus` SUCCESS kaldı** ve `amount` 0 oldu. Yani
   `paymentStatus` "ödeme başarılı OLMUŞTU" demek, "para hâlâ burada" değil. Beyaz liste olmasaydı
   parasını geri almış birine paket verirdik. Tutar koruması ikinci kez yakalıyor.
3. **Sabit `correlationId`.** TAMI tekrarı `4001` ile reddediyor, ve `confirm` **tasarım gereği**
   birden fazla çalışıyor (üye sayfayı yeniler, mutabakat tekrar sorar). Gerçek bir ödemenin ikinci
   sorgusu "ödenmemiş" diyordu. Canlıda birebir yaşandı.
4. **Tutar kontrolü yoktu.** Tutar token üretilirken sunucuda sabitlenir ve sayfa değiştiremez —
   dolayısıyla TAMI farklı bir tutar bildirirse bu "az ödedi" değil, **sipariş çakışması, tekrar
   sorgu ya da hata** demektir. Üçünde de paket verilmez. Karar saf fonksiyona çıkarıldı, 7 testi var.

#### Sağlayıcı, ödemenin özelliği oldu — ve iki hata daha buradan çıktı

Owner: *"6 taksit isteyene PayTR'den link veririz."* Bunun çalışması için sağlayıcının stüdyo ayarı
değil **ödemenin kendi kaydı** olması gerekiyordu. Değiştirirken:

- **PayTR webhook'u ayarlı sağlayıcıyla imza doğruluyordu.** TAMI'ye geçtiğimiz an PayTR'den gelen
  her bildirim TAMI'nin doğrulayıcısına düşecekti — o da her zaman `false`. **Para gelir, paket
  verilmez**, ve log'a ikna edici bir "bad hash" yazardı. Canlıya geçmeden bulundu.
- **İade, paranın çıktığı sağlayıcıya değil o anki ayarlıya gidiyordu.**

Resepsiyon artık "Linkle Ödeme"de sağlayıcı seçebiliyor. Ayarla oynamak gerekmiyor ve gerekmemeli.

#### Fiyat ve komisyon ekonomisi ([[OR-44]], [[OR-45]])

Pilates kampanya fiyatları girildi (8 Ders 4.200/5.000, 16 Ders 7.800/8.600) ve **asistanın bir
aydır sessizce yanlış olan kuralı** bulundu: `ai.policies` "fiyatlarımız TEKTİR, iki rakam söyleme"
diyordu. Temmuz'daki fitness kampanyası nakit fiyat kazandığında yanlış olmuştu ve **kimse fark
etmedi** — çünkü asistan doğru rakamları söylemeye devam etti (canlı veri kuralı eziyor). "Nakit daha
ucuz mu?" diye SORAN ilk kişide patlayacaktı.

Taksit tartışması iki kez döndü ve iki kez de **rakam kararı verdi**: 3 taksit sınırı TAMI tarafında
tanımlandı; vade farkı çarpanı reddedildi. İkinci turda owner "biz 4.200 + KDV olarak yorumluyoruz"
deyince **kendi tablomu düzelttim** — KDV kart fiyatının %16,67'si, komisyon %2,85-7,95, yani
**komisyon küçük ortak**. Kart satışı nakdin %83-90'ını getiriyor; eşik %80 olarak yazıldı.

#### Mobil 1.7.0 — beş iş, ve iki aylık bir sessizlik

Liste kapandı: rezervasyon onayı (+ Fit Paket maliyeti), `5/8` doluluk, Android push, push hatasının
bildirilmesi. Ayrıntısı aşağıdaki 1.7.0 bölümünde. **En önemlisi:** Firebase projesinde **Android
uygulaması hiç yokmuş** — Android üyelerin iki aydır token bile alamamasının sebebi buydu, ve boş
`catch` yüzünden hiçbir yer bunu söyleyemiyordu.

#### Panelde iki küçük ama pahalı hata

- **Tahsilat tutarı sessizce siliniyordu.** Resepsiyon 10 yazıp sonra yöntemi "Linkle Ödeme" yapınca
  alan paket tutarına geri dönüyordu — ve açılan sağlayıcı listesi alanın üstünü kapattığı için
  görünmüyordu. Link ₺2.500'e çıktı. Varsayılanı güncellemek doğruydu, **insanın yazdığı rakamı
  atmak** değil.
- **Paketler sekmesi "yavaş" değildi, boştu.** Ölçüldü: üyenin verisi 3 paket/2 satış, sunucu 230 ms.
  Radix sekme içeriğini söküyor, `load()` da listeyi önce boşaltıyordu. Hızlandırılacak sorgu yoktu;
  **gösterilmeyecek boş ekran** vardı.

#### Ve bir faz eklendi

**Faz 3 · Kadın Sağlığı Modülü** ([[ROADMAP]]) — owner'ın "uygulamayı sadece bize abone oldukları
için indirmesinler" sorusunun araştırılmış cevabı. Strateji B2C'ye çıkmak DEĞİL. Sıra: doğum sonrası
→ döngü modu → ölçüm zaman tüneli. Reddedilenler (fal, kalori fotoğrafı) gerekçeleriyle yazılı.

---

### 2026-08-22 (gece) — Fit Paket iki gündür ölüymüş: `buildSession` alanları düşürüyordu

Owner dersi kabul koşuluyla oluşturdu, ekran görüntüsünde kutu işaretliydi, "Seans oluşturuldu"
dedi. Üretimde bakıldığında seans belgesinde **ne `admission` ne `contentLabel`** vardı. Olay
`admission: {categories:['pilates_group']}` yani `defaultAdmission()` yazmıştı — yani veri
alan adama hiç ulaşmamıştı.

**Sebep:** `buildSession` (application/session.ts) her iki alanı da **parametre olarak alıyor ama
döndürdüğü nesneye koymuyordu.** Tip kontrolü geçiyor (ikisi de opsiyonel), 1069 test geçiyor, ve
özellik uçtan uca hiç çalışmıyor.

**İkinci hata, ilkinin arkasında saklıydı:** `infrastructure/mappers.ts` `admission`ı ne yazıyor ne
okuyordu (`contentLabel` vardı, `admission` unutulmuş). İlki düzeltilseydi bile belge yine boş
kalırdı — ve rezervasyon kuralı da üye ajandası da **belgeyi** okuyor.

Yani 20 Ağustos'tan beri yapılan işin tamamı — kategori duvarının genişletilmesi, ders türü
duvarının beyanla aşılması, ajandanın düzeltilmesi — doğruydu ve **hiçbiri devreye giremiyordu.**

**Neden hiçbir test yakalamadı:** her test bir katman sınırında duruyordu. Karar fonksiyonu
`admission`ı ZATEN olan bir seansla test edilmişti; action'ın ne ilettiği test edilmişti. Kimse
"kullanım senaryosuna admission ver, KAYDEDİLEN seansta var mı" diye sormamıştı. Artık soruyor:
`application/session.test.ts` (5 test; düzeltme geri alınınca 3'ü düşüyor — doğrulandı).

**Ders:** bir alanı uçtan uca eklerken kontrol edilecek yer sadece karar fonksiyonu değil, **veriyi
taşıyan her ara kat**: `buildSession` gibi elle yazılmış "nesne kur" fonksiyonları ve mapper'lar,
alanı sessizce düşürür. Tipler bunu yakalamaz çünkü alan opsiyoneldir. Testin katman sınırında değil,
**kullanım senaryosunun ucunda** durması gerekir.

**Bu deploy'dan sonra owner iki seansı yeniden oluşturmalı** (26 ve 28 Ağustos, ikisinin de
rezervasyonu yok) — mevcutları düzeltmek belge ile olayı çelişkiye düşürürdü.

---

### 2026-08-22 — Pilates kampanya fiyatı, ve asistanın kendi kuralıyla çelişmesi

**Yeni fiyatlar** (owner): Reformer Pilates 8 Ders → nakit 4.200 / kart 5.000 · 16 Ders → nakit
7.800 / kart 8.600 (kart fiyatı da 8.500'den yükseldi). `tools/migration/pilates-8-cash-price-2026-08.ts`.
Fiyat yalnızca ürün belgesine yazıldı; asistan katalogdan okuyor, ikinci bir yere yazmak iki doğru
üretirdi.

**Ama asıl bulunan şey ayrı:** `settings/ai.policies` içinde şu vardı —

> "ÖDEME/FİYAT — TEK FİYAT (EN ÖNEMLİ KURAL): Fiyatlarımız TEKTİR… Nakde özel indirimli bir liste
> YOKTUR… 'nakit şu, kartla bu' ŞEKLİNDE İKİ RAKAM SÖYLEME"

Bu kural yazıldığında doğruydu. Temmuz'daki fitness kampanyası üç pakete ayrı nakit fiyatı verdiğinde
**yanlış oldu ve kimse fark etmedi** — çünkü asistan doğru rakamları söylemeye devam etti: CANLI VERİ
bloğu iki fiyatı da yazıyor ve model veriyi kuralın üstüne koyuyor.

Yani hata bir aydır oradaydı ve **görünmüyordu.** Görünürdü: "nakit daha ucuz mu?" diye SORAN birine
kural devreye girer, asistan "fiyatımız tek hanımefendi" der — müşteri az önce iki fiyat almışken.

Üç yerde geçiyordu (`policies`, `examples`, `basics`), üçü de düzeltildi
(`tools/migration/ai-two-prices-2026-08.ts`). Yeni kural **rakam taşımıyor**: "listede kaç rakam
varsa o kadarını söyle". Katalog değişince asistan kendiliğinden doğru kalır.

**Ders:** asistanın prompt'una yazılan her iş kuralı, katalog verisinin ikizidir. Veri değişince
kural sessizce yalancı olur ve bunu hiçbir test yakalamaz. Fiyat/paket kuralı yazarken **rakam ya da
paket adı değil, veriyi nasıl okuyacağını** yaz.

**Son 1 haftada pilates fiyatı soran 4 kişi** vardı. Toplu gönderim yapılmadı — 24 saat penceresi
açık olan tek kişiye (tuğba bilici, sıcak lead) elle düzeltme mesajı gönderildi, sohbet geçmişine
yazıldı ve sohbet asistana geri verildi. Biri zaten stüdyoya davetliydi (resepsiyon yüz yüze
söyleyecek), ikisi fiyat noktasına gelmemişti. **"Kampanya başladı" denmedi, "eksik bilgi verdim"
dendi** — aynı rakam, ama biri reklam (İYS izni gerekir), diğeri müşterinin kendi sorusunun devamı.

**Uygun WhatsApp şablonu yok:** panelde yalnızca `balance_reminder` ve `portal_invite` tanımlı, ikisi
de fiyat bilgilendirmesine uzak. Fiyat duyurusu Meta'da MARKETING kategorisine girer (onay + izin +
İYS) — üç kişi için kurulmadı.

---

### 2026-08-22 — Turnike donanımı kesinleşti, parçalar sipariş edildi

Kararlar verildi, sipariş kilitlendi. Parçalar **24-25 Ağustos**'ta geliyor; firmware ondan sonra.

**Çift yönlü, çıkışta okutma ZORUNLU (owner kararı).** Telefonunu unutan üye içeride kalır ve gidip
alır — owner'a bunun bedeli söylendi, kararı o verdi. Karşılığında doluluk kesin.

**Sunucu tarafında yeni iş yok** — domain zaten bunun için yazılmış: `member.checked_out`,
`member.auto_checked_out` (okutmadan çıkanı gece süpürgesi temizler), `turnstile.opened_manually`
(resepsiyon elle açarsa zorunlu gerekçeyle olay yazılır).

**İki ekran = iki cihaz.** QR cihaza bağlı (`code.deviceId !== device.id → qr_invalid`), yani her
ekranın kendi kimliği, kendi sırrı, kendi QR'ı olacak. Bunun yan faydası: yön **okutulan ekrandan**
kesin gelir, `presence`'a bakıp çıkarmaya gerek kalmaz.

**Tek ESP32-S3, iki ekran.** İki kart önerilmişti, owner sorguladı, haklıydı: ekranlar turnike
gövdesinde 50 cm'den yakın olacak, o mesafede SPI sorun çıkarmaz. Ekranlar MOSI/SCK/DC/RST'yi
paylaşır, ayrı olan sadece **CS**. ~10 pin, S3'te bolca var.

**Parça listesi (sipariş verildi):** ESP32-S3 (elde) · 3.2" ILI9341 SPI ekran ×2 (dokunmatiksiz) ·
2 kanallı 5V röle kartı · buzzer · 5V 2A adaptör + USB-C · dişi-dişi dupont kablo 20cm + 30cm.
Breadboard'dan vazgeçildi (titreşimde gevşer, turnike gövdesine monte edilmez).

**Besleme:** adaptör → USB-C → ESP32-S3, röle VCC'si ESP32'nin **5V pininden** (o pin doğrudan
USB girişine bağlı, 3.3V regülatöre uğramıyor; iki bobin ~140 mA). Kart röle çektiğinde resetlenirse
besleme ayrılır — masada görülür. Kurulumda turnikenin 12V'undan **buck çevirici** ile beslenecek,
ayrı priz gerekmesin diye.

**12V kuru kontak sorun değil:** röle kartındaki "5V" bobin gerilimi, anahtarladığı devrenin değil.
Kontak değeri 10A@30VDC. **NO kullanılacak** (enerji giderse kontak açık kalır), ve turnikenin GND'si
ESP32'ye **bağlanmayacak** — kontak tarafının yalıtımını bozan tek şey odur.

**Owner'ın teknisyene söyleyecekleri** (yazılımla ilgisi yok, güvenlik):
- Enerji kesilince kollar **serbest kalsın** (fail-safe / anti-panik)
- **Yangın alarmı kontağı** turnikeye bağlansın

**Model: Perkotek S310** (S150 değil). Teknik doküman `~/Downloads/perkotekTurnike.pdf`, ve gereken
her şeyi veriyor:

**Menü ayarları (owner yapacak):** `F01 = 5` (açık kalma süresi — turnike KENDİ süresini sayar, yani
firmware'in 300 ms tetik vermesi yeterli, darbe süresi bizim derdimiz değil) · `F02 = 0` (her iki
yöne kilitli — çıkışta da okutma zorunlu, owner'ın kararı) · `F03 = 0` (bel turnikesi) ·
**`F04 = 0`** (hafıza modu 1 olursa röle iki kez tetiklediğinde iki kişi geçer ve doluluk sessizce
bozulur — bu en sinsi ayar).

**Röle girişi üç terminal: `OP-R` · `COM` · `OP-L`** — her yön için ayrı kuru kontak. 2 kanallı röle
kartı doğru seçimdi: kanal 1 → COM+OP-R, kanal 2 → COM+OP-L.

⚠️ **Şemada çelişki var:** karttaki butonlarda `OP-R = GİRİŞ`, `OP-L = ÇIKIŞ` yazıyor ama terminal
okları çaprazlanmış çizilmiş. **Tahmin edilmeyecek** — kurulumda COM bir kabloyla OP-R'ye değdirilip
hangi yönün açıldığına bakılacak. Yanlış bağlanırsa girişte okutan üye çıkış kolunu açar, kimse fark
etmez, doluluk ters döner.

**Yangın güvenliği donanımda çözülmüş:** "düşen kollu mekanizma, acil durumda kol düşerek serbest
geçiş". Enerji kesilince kollar düşüyor — ayrıca bir fail-safe ayarı aranmayacak.

**Besleme planı değişti:** turnike 220V (100-240V, 30W), 12V değil. Ama anakartta okuyucu beslemek
için konmuş bir **`GND`+`12V` çıkışı** var. Buck çevirici fikri geçerli ama önce **Perkotek'e
sorulacak: o çıkış kaç mA veriyor?** Bize ~250 mA lazım.

**Montaj:** gövde 480 mm; ESP32 **ortaya** konacak, böylece her ekrana ~24 cm kalır ve sipariş edilen
30 cm dupont yeter. Bir uca konursa diğer ekrana 50+ cm gerekir — hem kablo yetmez hem SPI zorlanır.

**Firmware sırasında sorulacak küçük ekleme:** `TurnstileDevice`'a **hangi taraf** olduğu alanı
(`giriş`/`çıkış`). Olay şemasına dokunmuyor, durum belgesine eklenen alan. Onunla yön tahmin
edilmez, bilinir.

---

### 2026-08-21 — Fit Paket kimseye görünmüyordu: duvarın yanlışını değil, ikincisini bulmak

Işıl "fit paket derslerini üyeler göremiyor" dedi. 26 Ağustos 18:30'da bir ders vardı ve **hiç
kimsenin ajandasında çıkmıyordu** — ne pilates paketi olanın, ne fitness üyesinin.

Üç ayrı sebep vardı, ve ilk ikisi bulunduktan sonra bile ders hâlâ görünmüyordu:

1. **Kod hatası** — `portal-query.ts` üç yerde `s.category` ile karşılaştırıyordu, kabul listesiyle
   değil. Yani domain'in seve seve kabul edeceği dersi ajanda saklıyordu. Duvarı 20 Ağustos'ta
   genişletirken okuma tarafı unutulmuştu. `admitsOf()` ile tek yerden okunuyor artık.
2. **Seansta kabul koşulu yoktu** — "Başka bir paket türüne de aç" kutusu işaretlenmemişti,
   `admission: null`. Bu fitness tarafını kapatıyordu.
3. **Asıl sebep: ders türü duvarı (I-9.8).** "Fit Paket" **yeni bir ders türü**, ve
   `productSnapshot.serviceIds` satın alma anında donuyor. Üretimde sayıldı:

   ```
   AKTİF PİLATES PAKETLERİ
     Fit Paket dersini KAPSAYAN : 0
     KAPSAMAYAN                 : 50
   ```

   Yani ders, **onun için yapıldığı pilates üyelerine de** kapalıydı. Kategori duvarını geçiyor,
   ders türü duvarına takılıyorlardı. Üç paketi olan üye bile göremezdi — sorun paket sayısı değil,
   dün açılmış bir ders türünün dünden önce satılmış hiçbir pakette yazmaması.

**Owner kararı (OR-43): beyan, ders türü duvarını da aşar.** `admission` beyanı olan seansta
`serviceIds` listesi uygulanmaz. Gerekçe: `serviceIds` bir varsayılan (paket neye karşı satıldı),
`admission` stüdyonun o tek ders hakkındaki açık kararı. Açık karar varsayılanı geçer.

Reddedilen alternatif: elli üyenin dondurulmuş snapshot'ını toplu güncellemek. **D12'nin var oluş
sebebi tam olarak onu engellemek** — bir katalog düzenlemesi satılmış paketin haklarını geriye dönük
değiştirmesin diye. Bir görünürlük sorununu çözmek için onu delmek, sorunu borca çevirmek olurdu.

Maymuncuk olmadığı testlerle yazılı: beyan yalnızca **saydığı kategorileri** alır (listede olmayan
paket hâlâ `category_mismatch`), yalnızca **o seansı** genişletir (kredi yine kendi paketinden
düşer), ve **beyanı olmayan her ders eskisi gibi** yargılanır. Aynı gevşetme `decideReschedule`'da
da yapıldı, yoksa üye dersi alır ama saatini değiştiremezdi; haftalık kota taşımada yeniden
çalıştırılmaz çünkü yer zaten onun.

**Bilinen iki eksik** (owner'a söylendi, ayrıca karar verecek):
- `admission` yalnızca seans **oluşturulurken** verilebiliyor. Var olan dersi sonradan açmanın yolu
  yok; silip yeniden oluşturmak gerekiyor. 26 Ağustos seansında **0 rezervasyon** var, o yüzden
  bedeli sıfır — ama her seferinde böyle olmayacak.
- **Şablonlar kabul koşulunu taşımıyor.** Haftalık üretilen seanslar `admission` olmadan doğuyor,
  yani düzenli bir Fit Paket dersi her hafta elle açılmak zorunda.

---

### 2026-08-20 — dört iş, ve bir tanesi veriye bakmasak yanlış yapacaktık

**QR check-in herkeste bozuktu.** Üye kodunu gösteriyor, resepsiyon okutuyor, "QR kod geçersiz".
İmza hep geçerliydi — bu yüzden görmesi zordu: anlamsız bir iddianın üzerine atılmış kusursuz bir
HMAC. `homeBranchId`'si olmayan bir üyede mobil uygulama `ctx.branchId ?? 'main'` ile **var olmayan
bir şube uyduruyordu**; jeton `'main'` için imzalanıyor, resepsiyon `mutlukent` gönderiyor, eşitlik
kontrolü reddediyordu.

Asıl kusur şubeye **istemcinin** karar vermesiydi. `mintCheckInToken` artık hiç şube almıyor:
üyeninkini, yoksa stüdyonun tek şubesini kullanıyor, çözemezse reddediyor. **Sunucuda düzeltildi**,
yani telefonlarda yüklü olan her sürüm mağaza güncellemesi olmadan düzeldi. Uygulamadaki
`?? 'main'` satırı 1.7.0'da temizlenecek; artık hiçbir etkisi yok.

**Ders türü ve salon düzenlenebilir oldu.** Sunucu üçünü de baştan beri yapabiliyordu
(`updateService`, `publishServicePolicy`, `updateRoom`); eksik olan kapıydı. Kategori bilerek
kilitli kaldı ve diyalog artık sebebini yazıyor. İki sonucu ekranda söylüyoruz: iptal penceresi
**bundan sonraki** derslere işler (D14), ve salon kapasitesini düşürmek açılmış dersleri küçültmez.

**"Paketin doluyor" ikiye ayrıldı.** Owner "süresi bitmiş ama 2 dersi kalmış üyeye rezervasyon
yapamıyoruz" diye başladı; ben uzatma düğmesi yapmaya hazırdım. **Önce veriye baktık:** stüdyonun
tüm geçmişinde 29 kredili paket dolmuş, bunların **6'sında kredi kalmış**, ve o altısındaki
kredilerin yarısı yanmış. Altı vaka bir iş akışı değil, istisna — düğme yapmak alışkanlık yapmak
olurdu. Asıl sorun uzatmak değil, **zamanında görmemekti.**

`expiring_with_credits` artık kendi satırı: ders sayısını başa alıyor, yenileme değil **derse
çağırma** öneriyor, aynı gün sayısındaki düz "doluyor" satırının üstüne çıkıyor. Para zaten
alınmıştı; yanan şey üyeydi — 16 dersin 10'unu kullanamayan kimse yenilemiyor.

**Fit Paket'e ders içeriği eklendi.** "Fit Paket" bir kap: bir hafta CrossFit, bir hafta Pilates
Mat. Üye ders adını görüp rezervasyon yaptığı için, içerik olmadan bir kelime rezerve ediyordu.
`class_session.scheduled` **v4 → v5** + upcaster (v4'te kavram yoktu, `null` bunu söyler — tahmin
değil). İçerik üyenin gördüğü ada **sunum katmanında** ekleniyor (`Fit Paket · CrossFit`), seansın
`serviceName` alanına yazılmıyor: raporlar ders türüne göre grupluyor, oraya yazsak bir tür haftada
bir bölünürdü. `serviceName` seçildi çünkü **mobil uygulamanın zaten bastığı tek alan o** — yüklü
her sürüm mağaza güncellemesi olmadan görüyor.

**İki günde iki olay sürümü (v4, v5) çirkin ama ikisi de dürüst.** Alternatif, seansın durumunda
olup olayında olmayan bir alan bırakmaktı; o, günlüğün var olma sebebini deler.

## 🌐 Tanıtım sitesi — biriken işler

`~/pilates-site` ayrı bir repo; ayrıntılı notlar orada `TODO.md` içinde. Buradaki liste sadece
"unutulmasın" içindir.

| # | İş | Not |
|---|---|---|
| 1 | **Google yorum sayısını siteye koy** — 2026-08-18 itibarıyla **124 yorum** | Sitede şu an hiçbir yerde geçmiyor. ⚠️ `aggregateRating` JSON-LD'si **eklenmeyecek**: Google kendi sitesinde kendi puanını işaretlemeyi (self-serving review) yasaklıyor ve bu manuel işlem sebebi. Görünür metin + Google profiline link doğrusu. |

### 2026-08-20 — Fit Paket: bir ders, iki üye grubu, farklı şartlar

Stüdyo, hem fitness hem pilates üyelerinin katılabildiği tek bir ders istedi: fitness üyeliği
**haftada bir kez ücretsiz**, pilates paketi **1 kredi**. Bu, sistemin en korunaklı kuralına —
kategori duvarı, I-9.7 — dokunuyordu, o yüzden owner onayıyla yapıldı.

**Sandığımızdan küçük çıktı, çünkü ücretlendirme farkı zaten modelde vardı.** Kredili paket
rezervasyonda kredi tutar, süreli üyelik hiçbir şey tutmaz; `selectEntitlement` de krediyi süreliye
tercih ediyor. Yani hibrit üyenin pilates kredisini ödemesi (owner'ın kararı) **sıfır kod** ile
karşılandı. Ayrı bir "ücret" kavramı yazılmadı.

**Duvar kalkmadı, yer değiştirdi.** Eskiden `paket.kategori === seans.kategori` idi; artık seans
`admission.categories` ile kimi kabul ettiğini söylüyor ve hiçbir şey söylemeyen seans kendi
kategorisini kabul ediyor. Mevcut her ders bire bir aynı davranıyor.

**Tek gerçek yeni kural haftalık hak.** Onsuz sınırsız bir üyelik, başkalarının kredi ödediği
dersten sınırsız yer alırdı. Hafta stüdyo saatiyle **pazartesi–pazar**; zamanında iptal hakkı geri
verir (sayıma girmez), gelmemek yakar (girer) — kredinin davranışıyla aynı, aynı gerekçeyle.

**Olay şeması:** `class_session.scheduled` **v3 → v4** + upcaster. Bu upcast "iyi" cinsten: bir v3
seansı **kendi kategorisini kabul ediyordu**, bu bir tahmin değil o sürümün anlamı — v2→v3'teki
iptal penceresinin aksine (o `null` kalır, çünkü bilinemez).

**Denormalize alan:** `reservations.sessionServiceId`. Doc 3 §6 defterine yeniden kurma yoluyla
birlikte yazıldı. Eski satırlarda yok ve geri doldurulmuyor; kotayı yalnızca kota beyan eden
seanslar tetikliyor ve öyle bir seans bu alandan önce yoktu.

**İki şey beni yakaladı, ikisi de mevcut testler sayesinde:**

1. `decideBooking` kategori duvarının **ikinci bir kopyasını** taşıyor — `isEligibleForService`ten
   bağımsız, ve asıl karar veren o. Yalnızca birini genişletseydim panel bir rezervasyonu teklif
   eder, domain reddederdi. Dosyanın kendi yorumu bu riski zaten yazmış.
2. `sessionServiceId`'yi rezervasyona ekleyeceğime **hata nesnesine** eklemişim (aynı satır iki
   yerde geçiyor, ilk eşleşme hataydı). İki eski test yakaladı.

**Yapılmadı, bilerek:** üye mobil uygulamada rezervasyon yaparken bunun ona neye mal olacağını
göremiyor. Fit Paket dersinde pilates üyesinden kredi düşecek, fitness üyesi bedava girecek, ekranda
hiçbir şey yazmıyor. Owner "A" dedi: ders bugünden açılabilsin, uyarı metni 1.7.0'a. **Aradaki
sürede Işıl'ın üyelere sözlü anlatması gerekiyor** — kredisi azalmış bir üye bedava sandığı derse
girip kredisini kaybederse resepsiyona gelir.

**Sırada:** "Fit Paket" ders türünün katalogda açılması (veri, kod değil).

## 📱 Mobil 1.7.1 — biriken işler

**Çıkmadı.** Aynı kural: mobil tarafta bulunan her şey burada birikir, bir arada çıkar. Bulan buraya
yazar.

| # | İş | Neden | Durum |
|---|---|---|---|
| 1 | **Sahte "Ödemen alındı"** — `outcomeFor` URL içinde `/portal` arıyordu | Stüdyo TAMI'ye geçince ödeme sayfası `portal.tami.com.tr` oldu ve `//portal.tami.com.tr` içinde `/portal` geçtiği için WebView sayfayı AÇAR AÇMAZ ekran "Ödemen alındı 🌸" diyordu — kart girilmeden, hiçbir şey olmadan. Canlı kayıtla doğrulandı: 08:36'daki niyet hâlâ `awaiting_payment`, ödeme yok, paket yok. Para hareket etmedi ama **ekran yalan söyledi**. Artık URL ayrıştırılıp HOST'a bakılıyor; sağlayıcının kendi sayfası asla bizim onayımız olamaz. | ✅ kodda (`e5b21db`) |
| 2 | **`0/8 dolu` DOLU diye okunuyordu** | Bomboş bir ders "0/8 dolu" yazıyordu; göz oranı değil kelimeyi görüyor ve üye boş salonu dolu sanıp rezerve etmeden kapatıyordu. Işıl bir üyeden duydu — sessizce rezervasyon kaybettiriyordu. Kelime kalktı, sayı tek başına duruyor; "son 2 yer" uyarısı kaldı, orada mesele oran değil acele. | ✅ kodda (`bc75579`) |
| 3 | **`expo-updates` (EAS Update / OTA)** | 2 numaradaki gibi bir KELİME düzeltmesi bugün mağaza sürümü istiyor: build, inceleme, yayılma, ve güncellemeyen üyelerde bir süre eski metin. Uygulama Expo 54 ama `expo-updates` kurulu değil. Kurulursa JS tarafındaki düzeltmeler mağazaya uğramadan dakikalar içinde iner. Sınırı net: **native değişiklik yine sürüm ister**. Bir kez kurulur, sonraki her metin düzeltmesi bedavadır. | ⏳ owner onayladı, kurulmadı |

**Neden i18n dosyası çözüm değil.** Metni `tr.json`'a taşımak da uygulamanın içinde paketlenir —
dili değiştirmeyi kolaylaştırır, *sürüm çıkarmadan metin düzeltmeyi* değil. Bugünkü sorun çokdillilik
değil, **düzeltmenin maliyeti**: aynı kelime panelde iki dakika, mobilde günler. Çözüm OTA.

**Her metni sunucuya taşımak da doğru değil** — her yazı için bir ağ isteği, bir yükleme durumu ve
"sunucu susarsa ne yazsın" sorusu doğar. Ayrım şu: **iş kararı olan metin** sunucudan (fiyat, kampanya,
kural), **arayüzün kendi dili** uygulamada. `0/8 dolu` ikinci gruptaydı ve yanlış anlaşıldı.

---

## 📱 Mobil 1.7.0 — biriken işler

**Bu liste bir sonraki mobil sürüme kadar büyür.** Bir mağaza sürümü ucuz değil: build, Apple'ın
incelemesi, Google'ın yayılması, ve güncellemeyen üyelerde bir süre eski davranış. O yüzden mobil
tarafta bulunan her şey tek tek çıkılmaz — burada birikir, sonra bir arada çıkar.

**Kural: bulan buraya yazar.** Aciliyeti olan bir şey çıkarsa (para, veri kaybı, güvenlik) bu liste
beklemez — o ayrı değerlendirilir.

| # | İş | Neden | Durum |
|---|---|---|---|
| 1 | **Android FCM push** — Firebase'de Android app, `google-services.json`, FCM anahtarı EAS'e, `googleServicesFile` config'e | Android üyeler HİÇBİR bildirim almıyor ve sistem bunu hiç raporlamıyor. Ayrıntı aşağıda. | ⏸ owner erteledi (2026-08-18) |
| 3 | **Fit Paket: rezervasyon ekranında ne ödeyeceğini göster** — "1 kredi" / "haftalık hakkın" | Üye bedava sandığı derste kredi kaybedebilir. Domain 2026-08-20'de çıktı, ekran metni çıkmadı. | ⏸ owner onayıyla ertelendi |
| 2 | **Push kaydı sessizce yutulmasın** — `src/lib/push.ts`'teki boş `catch`, hatayı sunucuya bildirsin | 1 numaralı arıza iki aydır sürüyor olabilir ve kimse fark etmedi. Asıl kusur push'un çalışmaması değil, **çalışmadığını söyleyememesi**. | ⏸ 1 ile birlikte |
| 4 | **Rezervasyondan önce onay adımı** — ders adı+içerik, tarih/saat, salon, ve **krediye ne olacağı** ("1 kredi düşecek · sonra 7 dersin kalır" / "haftalık hakkını kullanacaksın · kredi düşmez"). İptal penceresi de yazsın. | Şu an "Rezerve Et"e basınca **anında** yapılıyor: yanlış saate basan üye kredisini kaybediyor, geri almak elle düzeltme demek. Fit Paket'te iki üye grubu **farklı şey ödüyor** ve ekran bunu hiç söylemiyor — 3 numaralı iş bunun içinde eriyor. Owner: "çat diye rezerve ediyor". | ⏸ owner istedi (2026-08-22) |
| 5 | **Kontenjan doluluk olarak gösterilsin** — "3 kaldı" değil **`5/8`** | Kalan sayı dersin ne kadar dolduğunu söylemiyor: "3 kaldı" 8 kişilik derste de 20 kişilik derste de aynı görünüyor. Doluluk hem üyeye aciliyet hissi veriyor hem stüdyoya dürüst bir sinyal. Owner istedi (2026-08-22). | ✅ 1.7.0 |

**2026-08-25 — 1.7.0 çıktı. Beşi de yapıldı.** `1` ✅ · `2` ✅ · `3` ✅ (4'ün içinde) · `4` ✅ · `5` ✅

**Android push nasıl açıldı.** Firebase projesinde Android uygulaması **yoktu** — iki aydır Android
üyelerin token bile alamamasının sebebi buydu. Oluşturuldu
(`1:31996400558:android:78a731005a5efaff60ae3f`, paket `com.pilatesfitnessbyisil.member`),
`google-services.json` indirildi ve `app.config.js`e bağlandı. Dosya sır değil: APK'nın içine
derleniyor, erişimi Firestore kuralları belirliyor.

⚠️ **Bir adım OWNER'da ve build'i beklemiyor.** Expo'nun Android'e mesaj GÖNDEREBİLMESİ için EAS'te
FCM V1 anahtarı olması gerekiyor; `eas credentials` etkileşimli, betikle yüklenemiyor. Servis hesabı
ve anahtar hazırlandı: **`eas-fcm-push@studio-yonetim-prod.iam.gserviceaccount.com`**, anahtar
**`~/Downloads/eas-fcm-push-key.json`**.

```
cd apps/mobile && npx eas-cli credentials --platform android
  → production → Google Service Account
  → Manage your Google Service Account Key for Push Notifications (FCM V1)
  → Set up a Google Service Account Key → dosya yolunu ver
```

Bu yüklenmeden token ALINIR ama bildirim GİTMEZ. Yüklendiği an, zaten kurulu 1.7.0'larda çalışmaya
başlar — **yeni build gerekmez.**

**Rezervasyon onayı (4+3).** Artık "Rezerve"ye basınca doğrudan yapılmıyor: ders adı, gün+saat,
eğitmen/salon, **krediye ne olacağı** ve iptal penceresi gösterilip onay isteniyor. Maliyet cümlesi
sunucudan geliyor (`PortalSession.cost`), rezervasyonu yapan `selectEntitlement`'ın AYNISINDAN —
ekranda hesaplanan bir rakam, domain başka türlü davrandığı gün sessizce yalan olurdu. Alan
**opsiyonel**: eski sunucu/eski uygulama karşılaşırsa satır hiç yazılmıyor, uydurulmuyor.

**Push artık susmuyor (2).** `push.ts`teki boş `catch` gitti; hata `/devices`e bildiriliyor ve üyenin
kaydına `pushStatus` olarak yazılıyor. Asıl kusur push'un çalışmaması değildi — **çalışmadığını
söyleyememesiydi**; "reddetti" ile "bozuldu" buradan bakınca aynı görünüyordu. Artık sorusu sorgu.

### Buraya yazarken

Her satır şunu taşısın: **ne**, **neden** (hangi gerçek durum bunu gerektirdi), ve **doğrulandı mı**.
Doğrulanmamış bir teşhis için build çıkılmaz — 1 numaranın doğrulama adımı aşağıda yazılı.

### 2026-08-18 (gece) — card money on the checklist, a crop tool, and an Android silence

**Three things shipped in `build-2026-08-18-014`:** the legal set (above), the banner crop dialog,
and today's card takings at the top of the dashboard checklist.

**Why the card takings needed a home.** A ₺14.000 package was paid by payment link at 17:24 and the
owner could not find it, and assumed the callback had missed it. It had not: intent `paid`, payment
`pay_a6b8…` written, sale fully settled, entitlement active — the whole chain was correct. The money
simply had **nowhere to be seen**. An online payment carries no `drawerId` (it goes to the bank, not
the drawer, and putting it in the till would leave the evening count short by exactly that amount),
so it appeared in no till view, and the only place to check was PayTR's own panel.

It now sits FIRST on "Bugün İlgilenmen Gerekenler" — above the hot leads, because it is the only
line there describing something that has already happened. Severity `info`, deliberately: money
arriving is good news, and painting it the colour that means trouble teaches the eye to skim that
colour.

**Each line names where the payment came from** — member app · website · a link reception sent ·
Sanal POS at the desk. That was never stored on the payment; it is a property of the intent
(`purpose` + `flow` + who created it), joined by the id the two already share (`pay_<ref>` ↔
`pin_<ref>`). No new field, and it works retroactively for every payment ever taken.

**The banner crop dialog** exists because React Native's `Image` has no focal point — `cover` always
crops from the centre, and a designed campaign poster came out as a slice of itself. Cropping in the
PANEL rather than teaching the app an anchor was the whole point: a mobile change is a store release
plus a week of un-updated members seeing the old behaviour, whereas a cropped file renders correctly
on every phone that already has the app. Frames are measured from the app: 2.5:1 / 1200px for the
home banner, 1:1 / 1080px for the popup (that one is hard-coded to `aspectRatio: 1`). The original
and the transform are kept so re-editing never crops a crop.

### ⚠️ Android members receive no push notifications, and nothing says so

Found while answering "why does Play say 0 downloads?" (that part was a non-issue — Play buckets the
public figure and lags a day or two). Our own numbers, read from the device tokens the app registers
on launch:

```
toplam üye            161
uygulamayı açan üye    52   (%32)
son 24 saatte açan     31    ← the WhatsApp announcement worked
cihaz platformları     { ios: 59 }
```

**Fifty-nine registered devices, every one of them iOS.** Android is roughly two thirds of the
Turkish market; zero is not a coincidence. `apps/mobile/app.config.js` has no `googleServicesFile`
and there is no `google-services.json` in the repo, so `getExpoPushTokenAsync()` throws on Android —
and `src/lib/push.ts` swallows it:

```ts
} catch {
  // Push is a nice-to-have; never block the app on it.
}
```

The app opens and works; the device is simply never registered. So every Android member misses every
class reminder, payment notice and reservation confirmation, **silently**, and the install figure
above undercounts Android entirely.

**Owner's decision (2026-08-18): not now — write it down and pick it up on a free day.** The fix is
a Firebase Android app + `google-services.json` + the FCM key uploaded to EAS + `googleServicesFile`
in the config, then an Android build (1.7.0). Half an hour of work behind a store release.

**Verify before building**: install on one Android handset, sign in, and check whether that member's
`devices` subcollection gains a document. Confirmed diagnosis beats a confident one.

## Where 2026-08-09 ended — the three things somebody else has to do

Everything below is outside this repository. Nothing in the code is blocking any of them, and none
of them can be done from a terminal.

1. **The domain's ICANN verification e-mail, at Natro.** Unclicked for fifteen days and
   `retroasistan.com` is SUSPENDED — the platform's site and its mail stop together. The whole of
   today's rename rests on one confirmation link in `pilatesbyisil@gmail.com`.
2. **The external monitoring accounts** (~10 minutes) — `docs/RUNBOOK.md` → "Dış izleme". Two
   registrations: a healthchecks.io dead man's switch, AND an HTTP check on the panel itself. The
   second is not optional: the switch only proves the scheduled FUNCTION ran, and the panel is App
   Hosting — it can be down while the switch pings happily.
3. **A trademark attorney, for RETROASISTAN.** Neither "stüdyo asistan" nor "studio asistan" is
   registered at TÜRKPATENT, Turkey grants the right to whoever files first, and a competitor one
   letter away (`studioasistan.com`) can file any day. This is the only item on the roadmap whose
   clock somebody else is holding.

Plus, in its own time: **one real card charge** through the hybrid-bundle sale and Sanal POS. Those
are the two money paths this system has never executed for real, and they are the last thing left in
the operations gate.

---

## Things that will bite you

Read `docs/OWNER-RULES.md` §"Traps" before touching the areas it names. In short:

- **Every deploy breaks whatever tab is already open.** Next.js gives each Server Action a
  content-hashed id baked into the page; a new build changes the ids, and a page loaded before it
  gets `Failed to find Server Action … from an older or newer deployment` on the next save. It looks
  like the feature is broken. It is not — that copy of the panel is stale.
  **So: batch fixes into one push while the studio is open, and tell reception to reload once after.**
  Three pushes in ninety minutes on 2026-07-29 cost reception a member registration she could not
  save and a member an invite she could not activate; both were healthy, both tabs were not.
  Staff forms now name the cause and offer a reload button; the invite page reloads itself
  (`apps/web/src/lib/stale-deployment.ts`). Neither helps a page that was already open — only the
  reload does.
- **"Deploy oldu mu?" sorusunun tek doğru cevabı Cloud Run'ın trafik dağılımıdır.** App Hosting'in
  `builds`/`rollouts` listeleme uçları sıralamasız çağrıldığında eski bir sayfa döndürüyor ve
  2026-07-30'da iki kez "deploy tetiklenmedi" diye yanlış teşhise yol açtı — dağıtım çalışıyordu.
  Komut `docs/RUNBOOK.md`'de. Yanlış bir yeşil, kırmızıdan kötüdür: o gün stüdyo açıkken deploy
  edilmediği sanıldığı için resepsiyona haber verilmedi (OR-17).
- **Never hand-write a production document. Go through the use-case.** On 2026-07-31 five documents
  were written directly, each missing or mistyping a field its type declares, and each broke
  something: an `archivedAt` froze the member workspace; an entitlement with numeric dates where
  Timestamps were expected TOOK THE WHOLE PANEL DOWN; a `createdAt` on five exercises broke the
  training panel again; `photoUrl: ''` (the type says `string | null`) crashed the exercise detail;
  and two programme templates written with four of their nine fields showed as passive and
  unlabelled. The type is the contract — the screen you happen to be looking at is one reader of it.
  If no use-case exists for what you need, write one.
- **Core changes need TWO deploys.** Push updates App Hosting; the Cloud Functions need
  `firebase deploy --only functions`. The PAYTR callback that actually runs is the FUNCTION.
- **The emulator does not enforce Firestore indexes.** Ordering changes must be verified in prod.
- **`pnpm check` does not run `next build`.** Some rules only exist there (DEBT-031).
- **Production data is never edited by hand.** A paid-but-not-granted payment is settled through the
  break-glass endpoint on the callback function (`?admin=settle`, token = `WHATSAPP_VERIFY_TOKEN`),
  which runs the same domain path and writes the same events, with the actor recorded as
  `platform_admin/break_glass`.

## The invite templates at Meta — all approved, nothing pending

`uyelik_daveti_v2` was approved and the code switched to it on 2026-08-09. **There is no template
waiting at Meta.** The drafting instructions that lived here are gone with the wait; what is worth
keeping is the trap that cost a submission, because the next template will meet it too:

**Do NOT accept the "Kimlik Doğrulama" category Meta suggests.** Its classifier reads "şifreni
oluştur" and "giriş yaparsın" as authentication and offers that category as *Recommended*.
Authentication templates are locked to a one-time-passcode shape — fixed body, copy-code button, no
arbitrary links — so an invitation cannot exist there at all, and accepting it breaks invitations
entirely. The right category is Utility: this is a message about an account the member already has.
Word the body so it says nothing about passwords or logging in; the invite page explains that step
when she arrives, which is where it belongs.

Meta also refuses to review a template without **sample values** for every placeholder.

## Where the rest lives

| | |
|---|---|
| Why the system is shaped this way | `docs/architecture/` (`AD-nn`, 21 invariants) |
| How we work, milestone policy | `docs/architecture/10-development-workflow.md` |
| Standing owner decisions | `docs/OWNER-RULES.md` |
| Deliberate debt + repayment triggers | `docs/DEBT.md` |
| Ideas raised, not yet built | `docs/PRODUCT-FEEDBACK.md` (`PF-nn`) |
| Selling this to a second studio | `docs/PRODUCT-ROADMAP.md` |
| Operational procedures, backups | `docs/RUNBOOK.md` |
| What changed, milestone by milestone | `CHANGELOG.md` |

**And the git log.** Commit messages in this repository are written to explain *why*, not what —
`git log --oneline` is the honest history of every decision, including the ones that turned out
wrong and were reversed.
