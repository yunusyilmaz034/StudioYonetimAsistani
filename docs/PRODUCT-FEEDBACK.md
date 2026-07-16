# Product Feedback — Pilot

The single list for everything that surfaces while Işıl and the owner run the real studio on v1.0.0:
bugs, UX problems, operational gaps, speed ideas, new needs. The roadmap does NOT change; these
accumulate here and are triaged into V2 after the pilot. Each item: what · why · proposed fix · status.

Status: `backlog` (recorded, do later) · `in-progress` · `done` (struck through, kept for the record).

## PF-4 — Üye listesi sayfalama · ✅ `done`
2026-07-16 · owner. Üye ekranı tüm kayıtları tek seferde gösteriyor. İstenen: **10'ar kayıt**, tablo altında
**numaralı sayfalama**, üstte filtre (mevcut arama+çipler kalır), bir de **"Tümünü göster"** butonu. Client-side.

## PF-5 — KK/Havale ödeme farkı (+1000, ayardan) + taksit seçimi · ✅ `done`
2026-07-16 · owner. Kural: **sadece nakitte fark YOK**; diğer tüm ödemelerde (KK, havale, cüzdan-üyelik)
**default 1000 ₺** eklenir — **Ayarlar'dan düzenlenir** (kodda sabit değil). PAYTR ödemesinde tutar =
paket + fark, üyeye kırılım gösterilmez; **taksit seçimi** (max ayardan, default 3). Bu turda PAYTR kart
akışı yapılıyor.

## PF-6 — Fark'ı manuel satışa da uygula (havale/kart, nakit hariç) · ✅ `done` (2fd8c1c)
2026-07-16 · owner (PF-5'in kapsamı). Resepsiyon paketi manuel satarken (Kasa/sell akışı) yöntem nakit
DEĞİLSE aynı ayardaki fark uygulanmalı. PAYTR (kart) config'i inince bu ayrı akışa da bağlanacak. Cüzdan
üyelik ödemesi de dahil (cüzdan top-up hariç); cüzdan henüz seam (DEBT-035).

---

## PF-1 — "Ürün Sat" butonu Ayarlar ekranında olmamalı · `backlog`

**Taken:** 2026-07-16 · owner ("bunu notlara ekle, fix geçersin bir ara")
**Where:** Ayarlar → *Ürünler (Retail)* bölümü — sağ üstteki **"Ürün Sat"** butonu.
**Problem:** Ayarlar bir **yapılandırma** ekranı (ürün tanımla/düzenle/kapat). Ürün **satışı** burada olmamalı —
satış operasyonel bir iş, ayar değil. Aynı yerde "+ Ürün ekle" ve "Düzenle" doğru (bunlar yapılandırma),
ama "Ürün Sat" yanlış yerde.
**Proposed fix:** "Ürün Sat"ı Ayarlar'dan kaldır. Ürün satışı için ya (a) dashboard'a bir giriş/kısayol, ya da
(tercih) (b) menüye eklenen **ayrı bir "Ürün Sat" ekranı** — hızlı perakende satış (üye/müşteri seç → ürün →
adet → tahsilat). Ayarlar sadece kataloğu yönetsin.
**Notes:** Satış zaten `retail.ts` action'ında var (transactional stok düşümü, `retail_out_of_stock`); iş
sadece butonu doğru yüzeye taşımak + gerekiyorsa küçük bir satış ekranı. Düşük risk.

---

## PF-2 — Dropdown'lar açılmadan ham value gösteriyordu (svc_… / __none__) · ✅ `done` (43d94f0)

**Taken/Fixed:** 2026-07-16 · owner-reported, hotfix. Base UI `Select.Value` etiketi ancak popup bir kez
açılınca çözüyordu → ilk açılışta `svc_01K…` / `__none__` görünüyordu, app-genelinde. Merkezi fix:
paylaşılan `Select`, `SelectItem` çocuklarından value→label haritası türetip Root'un `items` prop'una
veriyor → tüm dropdown'lar ilk boyamada doğru etiketi gösteriyor. Canlıda.

---

## PF-3 — İptal edilen seans takvimde görünüyor (üstü çizili) · ✅ `done` (033a76f)

**Taken:** 2026-07-16 · owner ("yanlış açtım, iptal ettim ama ajandada üstü çizili gözüküyor; gözükmese
daha iyi mi?").
**Where:** Ders Ajandası (aylık görünüm) — iptal edilen seans üstü çizili + soluk gösteriliyor.
**Recommendation (benim):** **Tamamen gizleme; sadece daha da SOLUKLAŞTIR.** Sebep: (1) üstteki "İPTAL 1"
sayacı ile takvim çelişmesin (görünmezse "1 iptal var ama takvimde yok" daha kafa karıştırıcı olur);
(2) iptalin gerçekten olduğu, dürüst bir kayıt — "iptal ettim mi acaba" şüphesi kalmaz; (3) 15:30'a yeni
seans açınca, soluk-üstüçizili 15:00 açıkça "bu iptal, boşver" diye okunur. Takvim "sadece renk" kuralına
uygun (yalnızca opaklık/renk değişir, düzen değil). **Alternatif:** owner isterse "Tüm Durumlar" filtresi
varsayılan olarak "İptal"i hariç tutsun (istenince gösterilir). Karar owner'ın.

---

## PF-7 — Ayarlar ekranı dağınık, düzenlensin · `backlog`

**Taken:** 2026-07-16 · owner ("çok karışık, grupla, kaydet butonu ortada, dağınık").
**Where:** Ayarlar ekranı (Şirket · Çalışma saatleri · Rezervasyon kuralları · QR · Doluluk · Ödeme · Bildirim).
**Problem:** Tüm bölümler tek uzun kolonda akıyor, görsel gruplama zayıf; Kaydet butonunun yeri ortada/dağınık.
**Proposed fix:** Bölümleri **kart/gruplara** ayır (net başlık + kenarlık), iki-kolon düzeni tutarlı olsun,
**Kaydet**'i sabit alt bar (sticky footer) ya da her grubun net bir yerine al. Sadece görsel/düzen — davranış
(alan doğrulama, "boş-gerekli" uyarıları) aynı kalır. Düşük risk, orta iş.

---

## PF-8 — İkon-only butonlarda hover tooltip'i (app-geneli) · `backlog`

**Taken:** 2026-07-16 · owner ("bu buton siliyor mu değiştiriyor mu belli değil; mouse üstüne gelince küçük
popup söylesin — genel olarak tüm uygulamada").
**Where:** Her yerde, örnek: seans workspace → Rezervasyon satırı ikonları (Düzenle / Geçmiş / Seansa taşı /
Üye değiştir / İptal) — sadece ikon, etiketi yok, "siler mi değiştirir mi" belirsiz.
**Proposed fix:** Uygulamadaki **ikon-only butonlara** hover/focus **tooltip** ekle (ne yaptığını net Türkçe:
"Düzenle", "İptal et", "Başka seansa taşı" vb.). Yıkıcı olanlar (İptal/Sil) tooltip'te de belli olsun. En
temizi: paylaşılan bir `IconButton`/`Tooltip` deseni — tek yerde tanımla, tüm ikon butonlar `title`/tooltip
alsın. Erişilebilirlik artısı: `aria-label` da gelir. Düşük risk, orta iş (çok call-site).

---

## PF-9 — KVKK "anonimleştir" üye kartından çıksın, Ayarlar'a taşınsın · `backlog`

**Taken:** 2026-07-16 · owner ("her üye kartında kalıcı silme mantıksız + riskli; Ayarlar'da olsun, orada üye
seçip yapılsın").
**Where:** Üye kartı → Genel sekmesi → "KVKK — üye kaydını anonimleştir" paneli (`members/[id]/erasure-panel.tsx`).
**Problem:** Geri alınamaz kalıcı KVKK silme her üyenin detay ekranında duruyor — dağınık ve yanlışlıkla
tetikleme riski. Kişisel "Pasife Al" burada kalabilir (geri alınabilir); ama kalıcı silme burada olmamalı.
**Proposed fix:** Erasure panelini üye kartından **kaldır**, **Ayarlar** altında ayrı bir "KVKK / Gizlilik"
bölümüne taşı — orada üye ara/seç → anonimleştir. Yetki yine `platform_admin` (AD-67) kalır; bu sadece
YERİNİ değiştirir, davranışı/güvenliği değil. Orta iş (yeni küçük ekran + member picker), düşük risk.
