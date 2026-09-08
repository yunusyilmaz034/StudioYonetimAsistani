# Turnike ekranındaki Türkçe

`src/tr_fonts.h` ELLE YAZILMADI, üretildi. Üretim komutu burada durmazsa dosya bir daha
üretilemez — 150 KB'lik bir hex tablosunu kimse elle tamir etmez.

## Sorun

Adafruit_GFX'in yazdırma yolu karakteri `uint8_t` olarak taşıyor. `0xFF` üstündeki bir kod
noktası oradan geçemez, yani `ğ` (U+011F) doğrudan bastırılamaz. Eski çözüm ismi ASCII'ye
düşürmekti ve kapıda üyeye **"Hos geldin SULE GURSES"** diyordu.

## Çözüm

Türkçe glifler, Türkçe metinde ASLA geçmeyen Latin-1 yuvalarına yerleştirildi:

| harf | kod noktası | yuva |
|---|---|---|
| Ğ ğ | U+011E U+011F | `0xC0` `0xE0` (À à) |
| İ ı | U+0130 U+0131 | `0xCC` `0xEC` (Ì ì) |
| Ş ş | U+015E U+015F | `0xDE` `0xFE` (Þ þ) |

`ç Ç ö Ö ü Ü` zaten Latin-1'de; onlara dokunulmuyor. UTF-8'den bu yuvalara çeviren
`tr()` fonksiyonu `ui.cpp`de.

## Yeniden üretmek

```bash
# fontconvert, GFX kütüphanesinin içinden derlenir (freetype gerekir: brew install freetype)
cc -o /tmp/fontconvert "apps/turnstile/.pio/libdeps/esp32-s3-devkitc-1/Adafruit GFX Library/fontconvert/fontconvert.c" \
   -I/opt/homebrew/include/freetype2 -lfreetype

A="/System/Library/Fonts/Supplemental/Arial Bold.ttf"
for p in 9 11 18; do
  /tmp/fontconvert "$A" $p  32 255 > /tmp/lat_$p.h   # Latin-1 → ç ö ü ve boş yuvalar
  /tmp/fontconvert "$A" $p 286 351 > /tmp/tur_$p.h   # Latin Extended-A → ğ ı ş
done
python3 tools/merge-tr-font.py > apps/turnstile/src/tr_fonts.h
```

## Boylar neden 9 / 11 / 18

Ölçüldü, seçilmedi. 12 puntoda `QR Kodunuzu Okutun` **252 px** tutuyor ve 240 px'lik ekrandan
taşıyor; 11 puntoda 225 px. Yerleşimi karta atmadan önce ölçen betik `tools/merge-tr-font.py`
ile aynı gliflerden metin genişliği hesaplıyor — bir yazının taştığını turnikenin başında
öğrenmek pahalı.
