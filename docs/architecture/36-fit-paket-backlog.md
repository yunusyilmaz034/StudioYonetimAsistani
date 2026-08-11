# 36 · Fit Paket — bir ürün değil, bir kapsama hakkı (BACKLOG)

**Durum:** analiz bitti · owner kararları alındı · **kod YAZILMADI** (owner, 2026-08-11: *"bu işi
not al, şu anda yapma · konuşuruz, acelesi yok"*). Kod yazılmadan önce §5'teki son soru
cevaplanmalı.

---

## 1. İhtiyaç (owner'ın kendi tarifi)

Fit Paket, stüdyo dersleri: **crossfit · step aerobik · mat pilates · HIT cardio**. Ders ajandasında
normal seans olarak görünür, haftada 1-2 gün 2 seans açılır — ama bu takvim kararıdır, sistem genel
olmalıdır.

**Satın alınabilir bir ürün DEĞİLDİR.** Satış sırasında *"fitness paketine ek olarak Fit Paket'imiz
ücretsiz"* denerek verilen bir haktır. Yani bir katalog kalemi değil, mevcut pakete iliştirilmiş bir
kapsama kuralıdır — ve modellemesi bu cümleden çıkar.

| Üyenin paketi | Beklenen davranış |
|---|---|
| Fitness (süreli) | Rezervasyon yapabilir · **kredi ya da giriş düşmez** |
| Pilates (kredili) | Rezervasyon **1 pilates kredisi** tutar · iptalde kredi geri döner |
| PT (`private`) | **Kapsam dışı** (owner, 2026-08-11) |

Sınır: **yalnızca kontenjan.** Fitness paketi olan için ayrıca bir günlük/aktif rezervasyon limiti
konmayacak (owner, 2026-08-11).

---

## 2. En önemli bulgu: istenen kredi davranışı ZATEN var

Rezervasyon kararında tek satır (`reservations/domain/decide.ts`):

```ts
const creditEffect: CreditEffect = isCredit ? 'held' : 'none'
```

Tüketimi **seans değil, üyenin paketi** belirliyor:

- Fitness aylık → süreli paket, `credits === null` → `none`, hiçbir şey düşmez
- Reformer 8 Ders → kredili paket → `held`, iptalde bırakılır

`entryLedger` (fitness serbest-giriş sayacı) rezervasyon yolunda **hiç okunmuyor** — ölçüldü. Yani
*"fitness'lılarda kredi/giriş gözetme, pilates'lilerde pilates kredisinden düş ve iade et"* yeni bir
kural değil, kredi defterinin bugünkü davranışıdır. **Bu işte yazılacak yeni bir kredi kuralı yok.**

---

## 3. Önündeki tek engel: kategori duvarı (I-9.7)

```ts
if (entitlement.productSnapshot.category !== session.category) → category_mismatch
```

Bu bir invariant ve bilerek var: sınırsız fitness üyeliğinin reformer odasını açmamasını, PT
paketinin grup dersine girmemesini sağlayan şey odur. Fit Paket, **tek bir seansın iki kategoriden
açılabilmesini** istediği için ilk kez bu duvarla çelişiyor.

### Önerilen model — duvar bir KÜMEYE dönüşür

Servis, *"beni hangi kategoriler açabilir"* listesini taşır. Fit Paket servisleri için
`{ fitness, pilates_group }`; **diğer her servis için yalnızca kendi kategorisi**, yani bu bir
genişletmedir ve mevcut hiçbir davranış değişmez.

Yapılacak üç şey:

1. Duvar eşitlik yerine kümeye bakar.
2. **Kabul listesi seansa damgalanır** (`policySnapshot` gibi, I-24 kalıbı) — geçmiş bir rezervasyon
   bugünün kuralıyla değil, o günkü kuralıyla yargılanabilsin.
3. Seçim kuralı düzeltilir → §4.

**Kolaylık (ölçüldü, 2026-08-11):** aktif ürünlerin **hiçbirinde** `eligibleServiceIds` yok, hepsi
kategori geneli. Yani yeni servis açıldığında mevcut paketler onu kendiliğinden kapsar; geriye dönük
göç işi yok.

⚠️ `category` hem `productSnapshot`'a hem seansa damgalanıyor — **olay şemasına dokunan** bir
değişiklik, dolayısıyla owner kararı ve geri alınamaz (CLAUDE.md · "What the human owns").

---

## 4. Sessizce yanlış çalışacak yer: hangi paket öder?

`select-entitlement.ts` bugün şöyle sıralıyor:

```ts
// Credit entitlements are spent before period ones
```

Gerekçesi kendi bağlamında doğru: krediler yanar, sınırsız erişim yanmaz — bozulabilir olanı önce
harca. Ama Fit Paket'e uygulandığında **tam tersini** yapar: iki kategoriyi birden tutan bir üye Fit
Paket'e yazıldığında **pilates kredisi harcanır**, oysa fitness paketi o dersi bedavaya açıyordu.

Bugüne kadar hiç patlamadı çünkü bir seansı yalnızca tek kategori açabiliyordu. **Fit Paket bu
varsayımı kıran ilk şey.**

**Kural:** bir seansı birden çok kategori açabiliyorsa, **hiçbir şey tüketmeyen paket tercih edilir.**
Bu, bu işteki gerçekten yeni tek karardır.

---

## 5. Hibrit üye: giremez — ve bu, modeli değiştiriyor

**Owner kararı (2026-08-11): hibrit paketi olan üye Fit Paket'e HİÇ giremez.** Bedava/ücretli
ayrımı değil, kapsam dışı.

Bu, "bedava olmasın" seçeneğinden belirgin şekilde zor ve sebebi şu: hibrit bir demet zaten fitness
+ pilates entitlement'ı olarak veriliyor, ve **karar anında o fitness entitlement'ı tek başına
satılmış bir fitness paketinden ayırt edilemiyor.** Kategori aynı, süre aynı, kredisizliği aynı.

Dolayısıyla §3'teki "seans hangi kategorileri kabul eder" modeli bu kararı ifade edemez —
kategoriler eşit görünüyor. Model **hakkın PAKETTEN gelmesine** dönmek zorunda:

> Fit Paket'i açan şey üyenin kategorisi değil, **stüdyonun ona sattığı üründür.**

Bu aslında işin gerçeğine daha sadık: bu bir satış vaadi ("fitness alırsan Fit Paket bedava") ve
vaat ürün ürün veriliyor. Fitness 1/2/3/6/12 Aylık verir · pilates paketleri verir (krediyle) ·
hibritler vermez · PT vermez. İleride "bu pakette Fit Paket yok" demek de bir katalog kararı olur,
kod değişikliği değil.

### Bunun doğurduğu yeni soru (owner'a)

`productSnapshot` **satın alma anında donuyor** — fiyat değişikliğinin mevcut paketleri
etkilememesinin sebebi de bu. Yani hakkı ürüne yazarsak, **bugün elinde fitness paketi olan üyelerin
anlık görüntüsünde o hak yok** ve Fit Paket'e giremezler.

İki yol var, ikisi de savunulabilir ve seçim owner'ın:

- **Donmuş anlık görüntüye sadık kal** → hak yalnızca bundan sonra satılan paketlerde. Mevcut
  üyelere ayrıca tanımlanması gerekir.
- **Bu hakkı canlı katalogdan oku** → stüdyo bir şeyi *şimdi* hediye ediyor, o ürünü elinde tutan
  herkese. Donmuş anlık görüntü fiyatı korur; sonradan verilen bir hak fiyat değildir.

İkincisi işin ruhuna daha yakın görünüyor ama donmuş anlık görüntü ilkesine dokunduğu için
tartışılmadan yazılmaz.

## 6. Yapılacaklar (karar netleştikten sonra)

1. Hakkın ürüne yazılması (§5) — kategoriye değil; varsayılan: hiçbir ürün vermez
2. Seansa damgalama (I-24 kalıbı) + duvarın kümeye çevrilmesi + refüz mesajı
3. Seçim kuralı: çok kategorili seansta tüketmeyen paket önce
4. Fit Paket servislerinin açılması — **panelden, veri olarak** (AD-41; ders adları koda yazılmaz)
5. Domain testleri: fitness bedava · pilates kredi tutar · iptalde iade · **PT ve HİBRİT reddedilir**
