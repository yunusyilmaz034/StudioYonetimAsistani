import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

// AI RESEPSİYONİST — TEK FİYAT, NAKİT/KART AYRIMI YOK (owner, 2026-10-23)
//
//   pnpm tsx tools/migration/fix-ai-tek-fiyat-2026-10-23.ts            # kuru çalışma (değişen satırları gösterir)
//   pnpm tsx tools/migration/fix-ai-tek-fiyat-2026-10-23.ts --apply    # yaz
//
// Owner: *"tek fiyata gitmek istiyoruz çünkü kk farkı veya kk ile farklı fiyat olması suç teşkil ediyor. ai'a fiyat
// sorulduğunda bu fiyatlar verilsin, kk/nakit fiyatı gibi bir ayrımdan bahsetmesin; soran olursa da kk geçerli, daha
// detaylı bilgi için 0533 199 41 23'ü arayabilir ya da biz sizi arayabiliriz desin."* Fiyatlar Işıl'ın ilettiği dört
// metinden (Fitness, Reformer, Özel Ders, Hamile Pilatesi). Owner kararı: AI bu fiyatları, site/uygulama kart fiyatını
// söyler; panelde nakit/kart ayrımı kalır.
//
// Yapılan: `settings/ai.priceList` (yeni alan — doluysa AI fiyatı katalogdan değil buradan okur) + kampanya metni
// yenilenir + örnek/SSS/politika/temel bilgilerdeki her nakit/kart/peşin-taksit talimatı tek fiyat diline çevrilir.
// Her eski metin birebir aranır; bulunamazsa DURUR (panelden elle değişmişse körlemesine yazmaz).

const STUDIO = 'retro'
const APPLY = process.argv.includes('--apply')
const TEL = '0533 199 41 23'
const KART_CEVABI = `"Kredi kartı geçerlidir hanımefendi 🌸 Daha detaylı bilgi için ${TEL} numaralı telefonumuzu arayabilirsiniz, dilerseniz biz de sizi arayalım."`

const PRICE_LIST = `FİYAT LİSTESİ (Işıl, 23.10.2026). Her pakette listedeki rakamı söyle; başka rakam verme.

FITNESS — KADINLARA ÖZEL (sınırsız kullanım, rezervasyon yok)
- 3 Aylık Üyelik: 8.500 TL
- 6 Aylık Üyelik: 13.000 TL
- 12 Aylık Üyelik: 19.500 TL — +1 Ay Hediye ve +1 Ay Dondurma Hakkı
Üyelikte: sınırsız salon kullanımı · istediğin gün ve saatte giriş · kişiye özel antrenman programı · düzenli program güncellemeleri · mobil uygulamadan programa erişim · egzersizlerin videolu anlatımı · takip ve yönlendirme · düzenli vücut ölçümü.

ALETLİ PİLATES / REFORMER PİLATES (randevulu grup dersi)
- Aylık Üyelik — 8 Ders / 30 Gün: 4.200 TL
Fark: Spor Akademisi mezunu, TCF belgeli eğitmenler · mobil uygulamadan gün ve saat seçerek rezervasyon · en fazla 8 kişilik butik gruplar · sabit gün zorunluluğu yok · düzenli yağ-kas ve mezura ölçümleri · her hafta yenilenen programlar · dersten 6 saat öncesine kadar ücretsiz iptal.

BİREBİR ÖZEL DERS (PERSONAL TRAINING)
- 8 Ders: 12.000 TL
- 16 Ders: 20.000 TL
İçerik: hedeflere özel antrenman programı · uzman eğitmen eşliğinde birebir çalışma · hareketlerin doğru teknikle uygulanması · vücut ölçümlerinin düzenli takibi · postür (duruş) analizi · hedefe uygun beslenme desteği · gelişimin düzenli takibi. Sıkılaşmak, güçlenmek ya da formunu geliştirmek isteyene.

HAMİLE PİLATESİ (BİREBİR ÖZEL DERS)
- 8 Ders: 12.000 TL
- 16 Ders: 20.000 TL
Gebelik haftasına, doktor onayına ve ihtiyaca göre uzman eğitmen eşliğinde kişiye özel planlanır; gebeliği daha konforlu geçirmeye, nefes kontrolüne ve doğuma hazırlığa destek olur.

KREDİ KARTI / NAKİT / TAKSİT SORULURSA — tek cevap: ${KART_CEVABI}
Nakit fiyat, kart farkı, nakit indirimi, taksitli tutar ya da vade farkı hakkında HİÇBİR rakam ya da karşılaştırma verme.

BU LİSTEDE OLMAYAN PAKETLER (Hibrit paketler, 16 derslik pilates, 1–2 aylık fitness vb.): var olduğunu söyleyebilirsin ama FİYAT VERME — "Detaylı bilgi için ${TEL} numaralı telefonumuzu arayabilirsiniz, dilerseniz biz de sizi arayalım 🌸" de.`

const CAMPAIGN = `GÜNCEL KAMPANYA (owner, 23.10.2026):
- ÖNCELİK: 12 Aylık Fitness. Önce onu, gerekçesiyle anlat: aylık maliyeti en düşük paket; üstelik +1 ay hediye ve +1 ay dondurma hakkı var.
- Fiyatları FİYAT LİSTESİ'nden ver; nakit/kart/taksit konusunu SEN açma. Sorulursa yalnızca: ${KART_CEVABI}
- Kontenjan sınırlı, kayıtlar sırayla ilerliyor. Bunu bir kez, sakin ve nazik söyle — baskı kurma, her mesajda tekrarlama.
- Stüdyoya gelemeyen için uzaktan kayıt var: yetkilimiz ödeme linki gönderiyor ve üyeliği başlıyor. İsteyene bunu teklif et, sonra yetkiliye devret.`

// [alan, eski metin (birebir), yeni metin]
const REPLACE: readonly (readonly [string, string, string])[] = [
  ['examples', `(paketleri ve fiyatları CANLI VERİ'den al; listede tek rakam varsa tek, "Nakit … / Kredi Kartı …" yazıyorsa iki rakamı da söyle).`, `(paketleri ve fiyatları FİYAT LİSTESİ'nden al; her pakette listedeki rakamı söyle, ödeme şekli konusunu açma).`],
  ['examples', ` — 12 Aylık'ta kartla peşin fiyatına 3 taksit`, ` — 12 Aylık'ta +1 ay hediye ve +1 ay dondurma hakkı`],
  ['examples', `RAKAMLARI CANLI VERİ'den al (nakit ve kart fiyatını birlikte), buraya yazılmadı.`, `RAKAMLARI FİYAT LİSTESİ'nden al, buraya yazılmadı.`],
  ['examples', `8 Ders (1 aylık) …, 16 Ders (2 aylık) … \\n\\n**Fitness:**`, `8 Ders (1 aylık) … \\n\\n**Fitness:**`],
  ['examples', ` — RAKAMLARI CANLI VERİ'den al; ödeme şeklini bilmiyorsan her paket için nakit ve kart fiyatını birlikte ver. SONRA ekle: "Dilerseniz ikisini birleştiren hibrit paketlerimiz de var: Hibrit Aylık — 2 Pilates + 1 Fitness … (CANLI VERİ'den)…".`, ` — RAKAMLARI FİYAT LİSTESİ'nden al. SONRA ekle: "Dilerseniz pilates ve fitnessı birleştiren hibrit paketlerimiz de var 🌸 detaylı bilgi için ${TEL} numaralı telefonumuzu arayabilirsiniz, dilerseniz biz de sizi arayalım."`],
  ['basics', `FİYAT: Nakit/kredi kartı fiyatı ayrı olan paketlerde İKİ rakamı da CANLI VERİ listesinden ver —\nburaya rakam YAZILMAZ, zam yapıldığında burası sessizce yanlış olur.`, `FİYAT: yalnızca FİYAT LİSTESİ'ndeki rakamı ver; ödeme şekline göre yorum yapma.\nBuraya rakam YAZILMAZ, zam yapıldığında burası sessizce yanlış olur.`],
  ['basics', `(kampanya: aylık maliyeti en düşük paket, kartla peşin fiyatına 3 taksit)`, `(kampanya: aylık maliyeti en düşük paket, +1 ay hediye ve +1 ay dondurma hakkı)`],
  ['basics', `HİBRİT paketler (pilates + fitness birlikte), fiyatı CANLI VERİ'den.`, `HİBRİT paketler (pilates + fitness birlikte) — fiyat verme, ${TEL}'e yönlendir.`],
  ['basics', `· Fiyatı PT ile AYNIDIR: canlı listedeki ÖZEL DERS / PT paketinden ver, ayrı bir "hamile paketi" fiyatı UYDURMA.`, `· Fiyatı FİYAT LİSTESİ'ndeki HAMİLE PİLATESİ satırından ver (8 Ders / 16 Ders); başka rakam UYDURMA.`],
  ['policies', `paketleri satılıyor — ikisini de anlat ve fiyatlarını CANLI VERİ'den ver.`, `paketleri satılıyor — ikisini de anlat; 8 Ders'in fiyatını FİYAT LİSTESİ'nden ver, 16 Ders'in fiyatı listede yoksa "detaylı bilgi için ${TEL}" de.`],
  ['policies', `ÖDEME/FİYAT (EN ÖNEMLİ KURAL): Fiyat DAİMA CANLI VERİ listesinden okunur; asla hesaplanmaz, yuvarlanmaz, uydurulmaz. Listede o paket için KAÇ RAKAM yazıyorsa o kadarını söyle: tek rakam yazıyorsa o tutar nakit, havale/EFT ve kredi kartında aynıdır; "Nakit … / Kredi Kartı …" diye iki rakam yazıyorsa İKİSİNİ DE olduğu gibi söyle ve nakit fiyatını kartla ödeyecek birine verme. "Nakit daha ucuz mu / nakit fiyatınız nedir" diye sorulursa listeye bak: iki rakam varsa farkı açıkça söyle, tek rakam varsa "Fiyatımız tek hanımefendi 🌸 nakit, havale ve kredi kartında aynı tutarı ödüyorsunuz" de. Listede olmayan bir indirim ya da nakit farkı ASLA uydurma. TAKSİT: kredi kartına taksit yapılabilir; taksit seçeneğine göre VADE FARKI oluşabilir, bunu banka/ödeme altyapısı belirler — stüdyo fark eklemez ve oran belirlemez. Taksitli tutarı ya da oranı ASLA hesaplama/uydurma; "taksit seçeneklerine göre vade farkı oluşuyor, ödeme ekranında net tutarı görebilirsiniz" de. Nakit ve havalede taksit yoktur.`, `ÖDEME/FİYAT (EN ÖNEMLİ KURAL — yasal, owner 23.10.2026): Fiyat DAİMA FİYAT LİSTESİ'nden okunur; asla hesaplanmaz, yuvarlanmaz, uydurulmaz. Her pakette listedeki rakamı söyle. Nakit, havale, kredi kartı, fiyat farkı ya da indirim konusunu SEN açma; "fark var" ya da "fark yok / tek fiyat" gibi HİÇBİR yorum yapma. Kredi kartı, nakit, taksit ya da vade farkı sorulursa tek cevap: ${KART_CEVABI}`],
  ['policies', `dördünde de fiyatı CANLI VERİ listesinden ver, çekinme. Hamile pilatesi PT'nin alt branşıdır, PT fiyatıyla verilir.`, `fiyatı yalnızca FİYAT LİSTESİ'nden ver, çekinme; listede olmayan (hibrit, 16 ders vb.) için fiyat verme, ${TEL}'e yönlendir. Hamile pilatesi birebir özel derstir, fiyatı listede.`],
]
const FAQ: Record<number, readonly [string, string]> = {
  10: [`aylık maliyeti en düşük paket ve kredi kartına peşin fiyatına 3 taksit yapıyoruz.`, `aylık maliyeti en düşük paket ve şu an +1 ay hediye ile +1 ay dondurma hakkı veriyoruz.`],
}
const FAQ_ANSWER: Record<number, string> = {
  11: `${KART_CEVABI.slice(1, -1)} (Bu cümleyi AYNEN ver; fiyat farkı var/yok, tek fiyat gibi hiçbir yorum ekleme.)`,
  12: `${KART_CEVABI.slice(1, -1)} (Taksit sayısı, taksitli tutar ya da vade farkı hakkında rakam verme.)`,
}
const NEVER_DO = `Nakit / havale / kredi kartı FİYAT FARKINDAN, nakit indiriminden ya da kart farkından ASLA bahsetme — yasal zorunluluk (owner, 23.10.2026). Sorulursa: ${KART_CEVABI}`

type Faq = { q: string; a: string }

async function main(): Promise<void> {
  initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID ?? 'studio-yonetim-prod' })
  const ref = getFirestore().doc(`studios/${STUDIO}/settings/ai`)
  const ai = (await ref.get()).data() as Record<string, unknown>
  const next: Record<string, unknown> = {}
  const dur = (m: string): never => { console.error(`DUR: ${m}`); process.exit(1) }

  for (const [field, eski, yeni] of REPLACE) {
    const cur = String(next[field] ?? ai[field] ?? '')
    if (!cur.includes(eski)) {
      if (cur.includes(yeni)) continue
      return dur(`${field}: eski metin bulunamadı → "${eski.slice(0, 80)}…"`)
    }
    next[field] = cur.replace(eski, yeni)
    console.log(`✎ ${field}: "${eski.slice(0, 70)}…"`)
  }
  const faq = [...(ai.faq as Faq[])]
  for (const [i, [eski, yeni]] of Object.entries(FAQ)) {
    const f = faq[Number(i)]!
    if (f.a.includes(eski)) { faq[Number(i)] = { ...f, a: f.a.replace(eski, yeni) }; console.log(`✎ faq[${i}]`) }
    else if (!f.a.includes(yeni)) return dur(`faq[${i}] beklenen metin yok`)
  }
  for (const [i, a] of Object.entries(FAQ_ANSWER)) {
    const f = faq[Number(i)]!
    if (!/nakit|taksit/i.test(f.q)) return dur(`faq[${i}] sorusu beklenen değil: ${f.q}`)
    if (f.a !== a) { faq[Number(i)] = { ...f, a }; console.log(`✎ faq[${i}] cevabı → kart cümlesi`) }
  }
  next.faq = faq
  const never = String(ai.neverDo ?? '')
  if (!never.includes('FİYAT FARKINDAN')) { next.neverDo = `${NEVER_DO}\n${never}`; console.log('✎ neverDo: tek fiyat yasağı en üste') }
  if (ai.campaign !== CAMPAIGN) { next.campaign = CAMPAIGN; console.log('✎ campaign: 15 Eylül reklam/nakit-kart metni → güncel kampanya') }
  if (ai.priceList !== PRICE_LIST) { next.priceList = PRICE_LIST; console.log('✎ priceList: Işıl\'ın tek fiyat listesi') }

  // Kalan "nakit" geçen yer var mı? (yasak satırı ve SSS soruları hariç — onlar konuyu YASAKLIYOR.)
  const son = { ...ai, ...next } as Record<string, unknown>
  for (const k of ['basics', 'policies', 'examples', 'campaign', 'tone', 'identity', 'escalation']) {
    String(son[k] ?? '').split('\n').forEach((l, i) => { if (/nakit|kart fiyat|peşin fiyat/i.test(l)) console.log(`   ⚠ kalan: ${k}#${i}: ${l.slice(0, 140)}`) })
  }
  for (const [i, f] of (son.faq as Faq[]).entries()) if (/nakit/i.test(f.a)) console.log(`   ⚠ kalan: faq[${i}]: ${f.a.slice(0, 140)}`)

  console.log(`\n${APPLY ? 'UYGULANIYOR' : 'KURU ÇALIŞMA'} · ${Object.keys(next).length} alan`)
  if (!APPLY) { console.log('   --apply ile çalıştır.'); return }
  await ref.set(next, { merge: true })
  console.log('✅ yazıldı')
}

main().catch((e) => { console.error(e); process.exit(1) })
