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
