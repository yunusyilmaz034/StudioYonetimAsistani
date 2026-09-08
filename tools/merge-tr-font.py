"""Türkçe glifli GFX fontu üretir. Kullanımı: apps/turnstile/FONTS.md"""
import re, sys

# Türkçe glifleri, Türkçe metinde ASLA geçmeyen Latin-1 yuvalarına yerleştiriyoruz. Sebep:
# Adafruit_GFX'in print yolu char'ı uint8_t olarak taşıyor — 0xFF üstü bir kod noktası oradan
# geçemez. Yani "ğ"yi doğrudan yazdırmak mümkün değil; tek yol onu tek baytlık bir yuvaya koymak.
YUVA = {286: 0xC0, 287: 0xE0, 304: 0xCC, 305: 0xEC, 350: 0xDE, 351: 0xFE}  # Ğ ğ İ ı Ş ş

def parse(path):
    s = open(path).read()
    bm = re.search(r'Bitmaps\[\]\s*PROGMEM\s*=\s*\{(.*?)\};', s, re.S).group(1)
    byts = [int(x, 16) for x in re.findall(r'0x([0-9A-Fa-f]{2})', bm)]
    gl = re.search(r'Glyphs\[\]\s*PROGMEM\s*=\s*\{(.*?)\};', s, re.S).group(1)
    glyphs = []
    for m in re.finditer(r'\{\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*\}', gl):
        glyphs.append([int(x) for x in m.groups()])
    f = re.search(r'PROGMEM\s*=\s*\{\s*\(uint8_t\s*\*\)\w+,\s*\(GFXglyph\s*\*\)\w+,\s*0x([0-9A-Fa-f]+),\s*0x([0-9A-Fa-f]+),\s*(\d+)', s)
    return byts, glyphs, int(f.group(1), 16), int(f.group(2), 16), int(f.group(3))

def merge(lat_p, tur_p, name):
    lb, lg, lfirst, llast, ladv = parse(lat_p)
    tb, tg, tfirst, _, _ = parse(tur_p)
    out_b = list(lb)
    for cp, slot in YUVA.items():
        ti = cp - tfirst
        off, w, h, xa, dx, dy = tg[ti]
        n = (w * h + 7) // 8
        yeni = len(out_b)
        out_b.extend(tb[off:off + n])
        li = slot - lfirst
        lg[li] = [yeni, w, h, xa, dx, dy]
    L = []
    L.append(f'// Türkçe glifli GFX fontu — {name}. üretildi, elle yazılmadı — `apps/turnstile/FONTS.md`.')
    L.append(f'const uint8_t {name}Bitmaps[] PROGMEM = {{')
    for i in range(0, len(out_b), 12):
        L.append('  ' + ', '.join(f'0x{b:02X}' for b in out_b[i:i+12]) + ',')
    L.append('};')
    L.append(f'const GFXglyph {name}Glyphs[] PROGMEM = {{')
    for g in lg:
        L.append('  { %d, %d, %d, %d, %d, %d },' % tuple(g))
    L.append('};')
    L.append(f'const GFXfont {name} PROGMEM = {{(uint8_t *){name}Bitmaps, (GFXglyph *){name}Glyphs, 0x{lfirst:02X}, 0x{llast:02X}, {ladv}}};')
    return '\n'.join(L)

parts = ['#pragma once', '#include <Adafruit_GFX.h>', '']
for s, nm in [(9, 'TrSans9'), (11, 'TrSans11'), (18, 'TrSans18')]:
    parts.append(merge(f'/tmp/lat_{s}.h', f'/tmp/tur_{s}.h', nm))
    parts.append('')
sys.stdout.write(chr(10).join(parts))
