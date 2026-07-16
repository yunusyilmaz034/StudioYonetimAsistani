# Product Feedback — Pilot

The single list for everything that surfaces while Işıl and the owner run the real studio on v1.0.0:
bugs, UX problems, operational gaps, speed ideas, new needs. The roadmap does NOT change; these
accumulate here and are triaged into V2 after the pilot. Each item: what · why · proposed fix · status.

Status: `backlog` (recorded, do later) · `in-progress` · `done` (struck through, kept for the record).

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
