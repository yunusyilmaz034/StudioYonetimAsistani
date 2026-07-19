'use server'

import { z } from 'zod'

import { requireTenantContext } from '../auth'
import { adminDb } from '../firebase-admin'

// ── BİLGİ MERKEZİ (Knowledge Center) — a LIVING, owner-editable help base. Studio-scoped config
//    (studios/{sid}/knowledgeArticles), NOT event-sourced — the same lightweight choice as retail
//    products / notification templates. Non-PII, so the existing rules already allow desk reads and
//    deny client writes; every write goes through these owner-gated Server Actions. ──

const OPS = ['owner', 'receptionist', 'trainer', 'platform_admin'] as const
const OWNER = ['owner', 'platform_admin'] as const

export type KnowledgeCategory = 'scenario' | 'guide' | 'concept' | 'risk'

export interface KnowledgeArticle {
  readonly id: string
  readonly category: KnowledgeCategory
  readonly title: string
  readonly body: string // markdown (## headings, -, 1., **bold**)
  readonly order: number
  readonly pinned: boolean
  readonly updatedAt: number
}

function col(studioId: string) {
  return adminDb().collection('studios').doc(studioId).collection('knowledgeArticles')
}

export async function listKnowledgeArticlesAction(): Promise<readonly KnowledgeArticle[]> {
  const ctx = await requireTenantContext(OPS)
  const snap = await col(ctx.studioId).get()
  return snap.docs
    .map((d) => {
      const x = d.data()
      return {
        id: d.id,
        category: String(x.category ?? 'guide') as KnowledgeCategory,
        title: String(x.title ?? ''),
        body: String(x.body ?? ''),
        order: Number(x.order ?? 100),
        pinned: x.pinned === true,
        updatedAt: Number(x.updatedAt ?? 0),
      }
    })
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.order - b.order || a.title.localeCompare(b.title, 'tr'))
}

export async function upsertKnowledgeArticleAction(input: unknown) {
  const p = z
    .object({
      id: z.string().optional(),
      category: z.enum(['scenario', 'guide', 'concept', 'risk']),
      title: z.string().trim().min(1),
      body: z.string().trim().min(1),
      order: z.number().int().default(100),
      pinned: z.boolean().default(false),
    })
    .parse(input)
  const ctx = await requireTenantContext(OWNER)
  const ref = p.id ? col(ctx.studioId).doc(p.id) : col(ctx.studioId).doc()
  const { id: _omit, ...fields } = p
  void _omit
  await ref.set({ ...fields, updatedAt: Date.now() }, { merge: true })
  return { ok: true as const, value: { id: ref.id } }
}

export async function deleteKnowledgeArticleAction(input: unknown) {
  const p = z.object({ id: z.string().min(1) }).parse(input)
  const ctx = await requireTenantContext(OWNER)
  await col(ctx.studioId).doc(p.id).delete()
  return { ok: true as const }
}

// Import the curated starter set — ONLY when the base is empty, so it never overwrites the owner's own
// edits. After this, everything is hers to add/edit/remove (a living base).
export async function seedKnowledgeBaseAction() {
  const ctx = await requireTenantContext(OWNER)
  const existing = await col(ctx.studioId).limit(1).get()
  if (!existing.empty) return { ok: false as const, error: { code: 'already_seeded' as const } }
  const batch = adminDb().batch()
  const now = Date.now()
  DEFAULT_ARTICLES.forEach((a, i) => {
    batch.set(col(ctx.studioId).doc(), { ...a, order: i, pinned: false, updatedAt: now })
  })
  await batch.commit()
  return { ok: true as const, value: { count: DEFAULT_ARTICLES.length } }
}

// ── The curated starter content. Written against how the panel ACTUALLY works (2026). The owner edits
//    freely from here — this is only the seed. ────────────────────────────────────────────────────
const DEFAULT_ARTICLES: readonly { category: KnowledgeCategory; title: string; body: string }[] = [
  // ── SENARYOLAR ──
  {
    category: 'scenario',
    title: 'Eğitmen rahatsızlandı / derse gelemiyor',
    body: `Ders **yapılacak** ama eğitmen değişecek, ya da ders **iptal**.\n\n**Eğitmeni değiştir (ders yapılacak):**\n1. **Rezervasyon Ajandası** → ilgili seansı aç.\n2. **Toplu İşlemler** → *Eğitmen değişikliği* → yeni eğitmeni seç.\n\n**Sınıfı başka saate taşı:**\n1. Seansı aç → **Toplu İşlemler** → *Başka derse taşı* → hedef seansı seç.\n2. Herkesin rezervasyonu yeni seansa taşınır, kredi kaybı olmaz.\n\n**Ders hiç yapılmayacaksa:**\n- Dersin **kendisini iptal** et → herkesin kredisi **koşulsuz** iade edilir.\n\n⚠️ *Rezervasyonları iptal et* ile *dersi iptal et* farklıdır: ilki ders yapılacakken üyeyi çıkarır (normal iptal kuralı), ikincisi dersi tümden kaldırır (koşulsuz iade).`,
  },
  {
    category: 'scenario',
    title: "PAYTR'den ödeme geldi, ne yapmalı?",
    body: `Paylaştığın ödeme linkinden biri ödeme yaptıysa, para **kasaya "mutabakatsız tahsilat"** olarak düşer (henüz bir üyeye bağlı değil).\n\n1. **Kasa** → üstte *"eşleştirilecek tahsilat"* uyarısını gör.\n2. Tahsilatı aç → telefonla eşleşen üye önerilir; doğru üyeyi seç.\n3. Hangi **paketi** aldığını seç (kredi kartı ödemesi olarak işlenir) → **eşleştir**.\n4. Artık üyenin aboneliği + ödemesi panelde görünür.\n\n⚠️ Ödeme geldi ama üye yanlış eşleşirse: eşleştirmeden önce ad/telefonu kontrol et. Yanlış eşleştirme sonrası düzeltme zahmetlidir.`,
  },
  {
    category: 'scenario',
    title: 'Üyenin kredisi azaldı / bitti',
    body: `**Kredisi azalan üyeleri** owner panosunda "az kredi" listesinde görürsün.\n\n**Yenileme (yeni paket sat):**\n1. Üyeyi aç → **PAYTR ile Sat** (link/kart) ya da **Paketler** üzerinden manuel abonelik ekle.\n\n**Hediye / düzeltme kredisi eklemek:**\n1. Üye → **Paketler** sekmesi → ilgili abonelik → kredi ayarla.\n2. **Sebep** (hediye / düzeltme / devir / destek) + **not** zorunludur.\n\n⚠️ Krediyi **sıfırın altına** düşüremezsin — sistem reddeder. Bir dersi "geri almak" için düzeltme kredisi ekle, eksi girme.`,
  },
  {
    category: 'scenario',
    title: 'Üye derslerini sabitlemek istiyor (Sabit Rezervasyon)',
    body: `"Her Pazartesi ve Çarşamba 19:00, paketim boyunca yerim belli olsun."\n\n1. Üyeyi aç → **Rezervasyon** → **Sabit Rezervasyon** sekmesi.\n2. Sabitlemek istediğin **haftalık slotları** seç (ör. Pzt 19:00 + Çrş 19:00).\n3. Süre: **Paket süresince** (otomatik) ya da elle hafta sayısı.\n4. **Önizle** → hangi haftalar açılacak / hangileri neden atlanacak (ders yok, dolu, tatil).\n5. **Sabitle.**\n\nHer hafta **ayrı bir rezervasyon** olarak açılır. Üye bir haftayı tek başına **iptal edip başka saate** alabilir — seri bozulmaz.\n\n⚠️ Kredili pakette krediler bitince seri otomatik durur (kalan haftalar "kredi kalmadı" diye atlanır).`,
  },
  {
    category: 'scenario',
    title: 'Üye rezervasyonunu değiştirmek istiyor',
    body: `Üye bir dersini başka güne/saate almak istiyor.\n\n1. Üye → **Rezervasyonlar** sekmesi → mevcut rezervasyonu bul.\n2. **İptal et** — *iptal kuralı penceresi içindeyse* kredi iade edilir; **geç iptalde** kredi yanar (pakete göre).\n3. Sonra **Rezervasyon** → yeni günü/saati seç.\n\nAlternatif: Rezervasyon Ajandası'ndan seansı açıp üyeyi doğrudan **başka seansa taşı**.\n\n⚠️ İptal penceresi (ör. 6 saat) geçtiyse iptal kredi yakabilir — üyeye önceden söyle.`,
  },
  {
    category: 'scenario',
    title: 'Fitness üyesi "giriş hakkım doldu" diyor',
    body: `Sınırlı fitness üyeliğinde (ör. 30 günde 4 giriş) her **kapıda check-in** bir giriş hakkı yer.\n\n- Kioskta girişte **"3/4 giriş kaldı"** gösterilir; dolunca **turuncu "hak doldu"**.\n- Bu **yumuşak** bir tavandır: hak dolsa bile kapıda **engellenmez**, üye girer — sen görürsün.\n- Hakkı dolan üyeye **yeni paket sat** ya da düzeltme ile giriş ekle.\n\n⚠️ Sınırsız fitness üyeliğinde giriş hakkı sayılmaz. "Giriş hakkı" alanı sadece **süreli (sınırsız)** ürüne sayı girilince aktif olur.`,
  },
  {
    category: 'scenario',
    title: 'Üye cüzdanına para yükleyip ürün almak istiyor',
    body: `Üye ön ödemeli **Cüzdan** ile su/çorap/havlu/supplement alabilir.\n\n**Panelden yükleme:**\n1. Üye → **Cüzdan** sekmesi → tutar + kaynak (**Nakit** kasaya işlenir / Havale / Manuel) → **Yükle**.\n\n**Üye kendi yüklerse:** mobil/portal → Cüzdan → hızlı tutar → sanal POS (PAYTR).\n\n**Alışveriş:** üye mağazadan ürünü seçer, bakiyeden düşer. Reception da **Ürün Sat** → ödeme yöntemi **Cüzdan** ile satabilir.\n\n⚠️ Bakiye **sıfır altına** inmez; yetersizse satış reddedilir. Nakit yükleme kasaya girer (gün sonu sayımı buna göre).`,
  },
  {
    category: 'scenario',
    title: 'Yeni üye geldi — kayıt, paket, ödeme',
    body: `Baştan sona yeni üye akışı:\n\n1. **Üyeler** → **Yeni Üye** → ad soyad + **telefon** (zorunlu, E.164'e çevrilir).\n2. Üyeyi aç → **PAYTR ile Sat** (kart/link) ya da **Paketler**'den manuel abonelik ata.\n3. Ödemeyi şimdi almazsan **açık hesap** olur (borç görünür) — sonra **Kasa/Cari**'den tahsil edersin.\n4. Gerekiyorsa **Sabit Rezervasyon** ile günlerini sabitle.\n\n⚠️ Telefon benzersizdir; aynı telefon iki kez kaydedilemez (çakışma bildirilir, birleştirilmez).`,
  },
  // ── REHBERLER ──
  {
    category: 'guide',
    title: 'Ödeme alma ve Kasa',
    body: `Ödeme yöntemleri: **Nakit, Havale, Kredi Kartı (POS), PAYTR (online), Cüzdan, Hediye Kartı**.\n\n- **Nakit/POS** bir **kasaya** (till) düşer → gün sonu sayımı buna göre yapılır.\n- **Havale/online** kasaya girmez, doğrudan tahsilat.\n- Bir satış **kısmi** ödenebilir; kalan **borç (açık hesap)** olarak kalır.\n\n**Gün sonu:** Kasa → kasayı kapat → sayılan tutarı gir → fark otomatik kaydedilir (gizlenmez).\n\n⚠️ Yanlış tahsilatı **silme** — **void** et (sebep zorunlu). Silme yok, düzeltme var.`,
  },
  {
    category: 'guide',
    title: 'Ders ajandasına ders ekleme',
    body: `1. **Ders Ajandası** → gün/saat seç → **ders ekle**.\n2. **Hizmet** (Reformer, Grup Fitness…), **oda**, **eğitmen**, **kapasite** gir.\n3. Kaydet → seans üyelerin rezervasyonuna açılır.\n\n**Tekrarlı ders:** bir seansı şablon gibi haftalık tekrarlayabilirsin.\n\n⚠️ Kapasiteyi odanın gerçek kapasitesinin üstüne çıkarma. Seans **kategorisi** (pilates/fitness) üyenin paketiyle eşleşmezse o üye rezervasyon yapamaz — bu kasıtlıdır (kategori duvarı).`,
  },
  {
    category: 'guide',
    title: 'Antrenman: program, şablon, egzersiz',
    body: `**Egzersiz** = tek bir hareket (kas grubu, rehber, video/görsel). **Antrenman** menüsünden eklenir/düzenlenir.\n\n**Şablon** = yeniden kullanılabilir program taslağı (ör. "3 Günlük Başlangıç"). Bir üyeye uygulayınca ona özel **program** olur.\n\n**Program atama:**\n1. Üye → **Antrenman** sekmesi → yeni program (boştan / şablondan / **AI öneri**).\n2. Günleri + egzersizleri düzenle → **yayınla** → **Aktif Yap**.\n\n⚠️ Programlar **fitness/PT** üyeleri içindir. Sadece pilates üyesi program görmez (yalnız ölçümlerini görür).`,
  },
  {
    category: 'guide',
    title: 'Paket / ürün tanımlama (Katalog)',
    body: `**Paketler** ekranından abonelik ürünlerini tanımlarsın.\n\n- **Tür:** *Kredi* (N ders) veya *Süreli* (sınırsız erişim).\n- **Kategori:** Pilates / Fitness / Özel(PT) — **kategori duvarını** belirler.\n- **Giriş hakkı** (sadece süreli): boş = sınırsız; sayı = fitness serbest-girişte o kadar giriş.\n- Günlük/aktif rezervasyon limiti, iptal hakkı, dondurma hakkı opsiyoneldir.\n\n**Perakende ürünler** (su, çorap…) → Ayarlar → Perakende.\n\n⚠️ Kategori ürünün en kritik alanıdır — yanlış kategori üyenin yanlış derslere girmesine/girememesine yol açar.`,
  },
  // ── KAVRAMLAR ──
  {
    category: 'concept',
    title: 'Kasa, Cari Hesap, Alacak/Verecek, Açık/Kapalı',
    body: `- **Kasa (till):** fiziksel nakit/POS'un toplandığı yer; gün sonu buradan sayılır.\n- **Cari hesap:** bir üyenin borç/alacak durumu. **Pozitif = üye sana borçlu** (alacağın var); negatif = üyenin sende parası var (fazla ödeme).\n- **Açık satış:** ödenmemiş/kısmi ödenmiş satış (borç var). **Kapalı (settled):** tamamı tahsil edilmiş.\n\nHer sayı **hareketlerden türetilir** — hiçbir yerde elle "bakiye" tutulmaz, o yüzden yanlış olamaz; sadece bir hareket yanlış olabilir (o da void/düzeltme ile).`,
  },
  {
    category: 'concept',
    title: 'Kredi vs Giriş Hakkı vs Sınırsız',
    body: `- **Kredi:** rezervasyonla tutulur, **katılımda** tükenir (pilates dersleri böyle). Rezervasyon = 1 kredi bloke; katıldı/gelmedi/geç-iptal → tükenir; zamanında iptal → geri döner.\n- **Giriş hakkı:** fitness **serbest-girişte** her **kapı check-in'inde** tükenir (rezervasyon değil). Yumuşak tavan.\n- **Sınırsız:** süreli üyelik, sayaç yok.\n\nBiri rezervasyonu, diğeri fiziksel girişi sayar — karıştırma.`,
  },
  {
    category: 'concept',
    title: 'Kategori Duvarı (Pilates / Fitness / PT)',
    body: `Her üyeliğin **tek** bir kategorisi vardır. Rezervasyon/erişim ancak **paketin kategorisi = dersin kategorisi** ise açılır.\n\n- Fitness aboneliği **pilates** (reformer) dersini açmaz.\n- PT paketi grup dersini açmaz.\n\nBu kasıtlı ve değiştirilemez bir kuraldır — fitness/pilates katılımını, oda doluluğunu, kredi tüketimini ayrı ayrı doğru ölçmemizi sağlar.\n\n**Combo isteyen üye:** iki ayrı abonelik ekle (ör. 4 kredi pilates + 4 giriş fitness). İkisi ayrı yaşar, üye ikisini de taşır.`,
  },
  {
    category: 'concept',
    title: 'Check-in vs Katılım (Yoklama)',
    body: `- **Check-in:** üye **kapıdan girdi** (doluluk + fitness giriş hakkı). Kioskta QR ile.\n- **Katılım (yoklama):** üye **derste görüldü** (pilates kredisi burada tükenir). Eğitmen/reception işaretler.\n\nİkisi farklıdır. Check-in'i katılım sanmak metrikleri bozar. Rezervasyonu kimse iptal etmediyse üye **varsayılan katıldı** sayılır (ama bu bir gözlem değil, varsayımdır — sistem ayrı işaretler).`,
  },
  {
    category: 'concept',
    title: 'Cüzdan (ön ödemeli bakiye)',
    body: `Cüzdan, üyenin **ön ödemeli** parasıdır — hediye kartı gibi bir **yükümlülük**tür.\n\n- Para **yüklenince** gelir yazılmaz; **harcanınca** (ürün alınca) gelir olur.\n- Yükleme: PAYTR (üye) ya da panelden nakit/manuel (reception).\n- Harcama: mağazadan ürün (su/çorap…), ödeme yöntemi **Cüzdan**.\n- Bakiye **sıfır altına** inmez.`,
  },
  // ── RİSKLİ / SIK HATA ──
  {
    category: 'risk',
    title: '⚠️ Geri alınamaz işlemler',
    body: `Bunlar **kalıcıdır**, dikkatli ol:\n\n- **Olay kaydı (event log) silinmez/değişmez.** Her şey buraya yazılır; düzeltme = yeni bir karşı-kayıt.\n- **Ödeme silinmez** → **void** edilir (sebep zorunlu).\n- **Elle Firestore / veritabanı düzenleme YASAK.** Para/kredi her zaman panel üzerinden (olay üreten yol) değişir. Elle düzenleme kayıtları bozar.\n- **Üye silme** yerine pasifleştir (geçmiş korunur).\n\nEmin değilsen: küçük bir düzeltme kaydı > sessiz bir elle değişiklik.`,
  },
  {
    category: 'risk',
    title: '⚠️ Sık yapılan hatalar',
    body: `- **Yanlış kategori paket:** fitness üyesine pilates paketi (ya da tersi) satmak → üye derse giremez. Satarken kategoriye bak.\n- **Krediyi eksiye çekmeye çalışmak:** reddedilir; düzeltme kredisi kullan.\n- **PAYTR tahsilatını yanlış üyeye eşleştirmek:** eşleştirmeden ad/telefon doğrula.\n- **Geç iptalde kredi yandı sanmak:** pakete göre değişir; iptal penceresini kontrol et.\n- **Nakit yüklemeyi kasaya işlememek:** panelden yaparsan otomatik işlenir; dışarıda alınan nakit gün sonunu şaşırtır.\n- **Sabit rezervasyonu tek tek yapmak:** Sabit Rezervasyon aracını kullan, tek tek uğraşma.`,
  },
]
