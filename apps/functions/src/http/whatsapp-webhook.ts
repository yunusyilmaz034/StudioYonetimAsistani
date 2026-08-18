// The WhatsApp AI receptionist — inbound webhook (Faz 2, Blok 2a). Built on the paytr-callback pattern.
//
// Meta calls this URL two ways:
//   • GET  ?hub.mode=subscribe&hub.verify_token=…&hub.challenge=…  — the one-time verification handshake.
//   • POST { entry: [{ changes: [{ value: { messages, contacts } } }] } }  — an inbound message.
//
// On an inbound TEXT message we: store the conversation (studios/{sid}/conversations/{phone}), and — ONLY
// if the owner has flipped `settings/ai.whatsappActive` ON — ask Claude for a reply from the studio's
// knowledge card (settings/ai) + LIVE facts (active products/prices — never the schedule) + the
// conversation history, then send it back with a free-form text message (allowed inside the 24h window).
// PII (name/phone/message text) lives on the conversation doc (server-only), NEVER in an event. The model
// sees the customer's own words (unavoidable for a reply) but no other member's data.
import {
  productPrices,
  decideCaptureLead,
  FirestoreCatalogRepository,
  FirestoreCrmRepository,
  FirestoreIdentityRepository,
  instant,
  notify,
  newCorrelationId,
  sendWhatsAppText,
  type CardSurchargeConfig,
  type Lead,
  type MetaWhatsAppConfig,
  type Product,
  type TenantContext,
} from '@studio/core'
import { getAuth } from 'firebase-admin/auth'
import type { Firestore } from 'firebase-admin/firestore'
import * as logger from 'firebase-functions/logger'
import { onRequest } from 'firebase-functions/v2/https'

import { db } from '../shared/firebase'
import { notificationDeps, studioNotificationSettings } from '../triggers/on-event-notify'
import { AI_RECEPTIONIST_SECRETS, REGION } from '../shared/region'

const MAX_HISTORY = 24 // messages kept per conversation for context + storage
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
// The WhatsApp receptionist is the ONE surface a prospective member actually talks to, so it runs a
// stronger model than the internal AI features (the checklist and the owner assistant stay on Haiku —
// nobody outside the studio reads those). Haiku produced Turkish that was fluent-but-wrong often
// enough to matter: it answered a customer's "if I'm not tiring you" with "you will never ask",
// which is nonsense. Roughly 2-3× the cost per conversation, on the order of tens of TL a month.
const MODEL = 'claude-sonnet-5'

type Role = 'user' | 'assistant'
interface Msg {
  role: Role
  text: string
  at: number
}
interface Conversation {
  phone: string
  name: string
  status: 'ai' | 'human'
  needsAttention: boolean
  // WHY the desk is being called. Two very different events used to share one flag and one alert:
  //   'handoff'   — the assistant decided a human should answer (normal, expected, a good sign)
  //   'ai_failed' — the assistant produced nothing (a fault: on 2026-07-25 three customers were left
  //                 on read this way, and the desk had no way to tell it apart from a handoff)
  // Same badge, different sentence — because the response to each is different.
  attentionReason?: 'handoff' | 'ai_failed' | 'hot_lead'
  lastAt: number
  seenIds: string[]
  messages: Msg[]
  temp?: 'sıcak' | 'ılık' | 'soğuk' // AI's read of conversion likelihood (updated each turn)
  reason?: string
}

interface AiSettingsDoc {
  tone?: string
  identity?: string
  basics?: string
  policies?: string
  campaign?: string
  faq?: { q: string; a: string }[]
  escalation?: string
  neverDo?: string
  examples?: string
  whatsappActive?: boolean
}

const tl = (kurus: number) => `${(kurus / 100).toLocaleString('tr-TR')} TL`

function ctxOf(sid: string): TenantContext {
  return { studioId: sid as never, branchIds: [], role: 'owner', actor: { type: 'system', id: 'whatsapp_webhook' } as TenantContext['actor'] }
}

// Compact LIVE facts the reply must be grounded in: active packages with prices, and NOTHING about
// the schedule (see below). Read straight from Firestore (same repos paytr-callback uses).
async function liveFacts(database: Firestore, ctx: TenantContext): Promise<string> {
  const parts: string[] = []
  try {
    const products = (await new FirestoreCatalogRepository(database).listProducts(ctx)).filter((p: Product) => p.active)
    const surchargeCfg = (await database.doc(`studios/${ctx.studioId}/settings/studio`).get()).get('paymentSurcharge') as
      | CardSurchargeConfig
      | undefined
    if (products.length) {
      parts.push('GÜNCEL PAKETLER (fiyatlar buradan, ASLA uydurma):')
      let twoPrices = false
      for (const p of products) {
        // `priceInKurus` is the CARD price. A second price exists in exactly two ways, and they are
        // mutually exclusive by construction (member-api.ts makes the same choice): the product carries
        // its OWN cash price — the campaign case, where the gap is neither a fixed amount nor a
        // percentage — or the category rule derives the card price from it. Neither ⇒ ONE number is
        // written: "Nakit 5.000 ₺" implies a second price that does not exist, and the customer then
        // wonders what the card screen will say.
        const { cashKurus, cardKurus } = productPrices(p, surchargeCfg)
        const split = cardKurus !== cashKurus
        if (split) twoPrices = true
        const price = split ? `Nakit ${tl(cashKurus)} / Kredi Kartı: ${tl(cardKurus)}` : tl(cashKurus)
        // Hibrit demet: bileşenleri anlat (ör. "8 Pilates dersi + 4 Fitness girişi / 30 gün").
        const CAT_TR: Record<string, string> = { pilates_group: 'Pilates', fitness: 'Fitness', private: 'PT' }
        const detail =
          p.components && p.components.length > 0
            ? `${p.components.map((c) => (c.creditCount != null ? `${c.creditCount} ${CAT_TR[c.category] ?? c.category} dersi` : `${c.entryAllowance ?? 0} ${CAT_TR[c.category] ?? c.category} girişi`)).join(' + ')} / ${p.durationDays} gün`
            : p.type === 'credit'
              ? `${p.creditCount ?? 0} ders / ${p.durationDays} gün`
              : `${p.durationDays} gün sınırsız`
        parts.push(`- ${p.name} (${detail}): ${price}`)
      }
      // The instalment sentence, generated from the SAME data as the prices so the two can never
      // disagree. The studio quotes no instalment rate because it sets none — the card offers the
      // plan and PAYTR applies the bank's vade farkı (owner: "biz karışmıyoruz").
      const maxTaksit = Number((surchargeCfg as { maxInstallments?: number } | undefined)?.maxInstallments ?? 0)
      const taksit =
        maxTaksit > 1
          ? `Kredi kartına ${maxTaksit} taksite kadar imkân vardır; taksit seçeneğine göre vade farkı oluşabilir ve bunu ödeme kuruluşu/banka belirler, stüdyo belirlemez.`
          : 'Kredi kartına taksit imkânı vardır; taksit seçeneğine göre vade farkı oluşabilir, bunu banka/ödeme altyapısı belirler, stüdyo belirlemez.'
      const kural =
        'Taksit oranı veya taksitli tutar SORULURSA rakam UYDURMA: "taksit seçeneklerine göre vade farkı oluşuyor, ödeme ekranında net tutarı görebilirsiniz" de.'
      parts.push(
        twoPrices
          ? `ÖDEME: Yukarıda İKİ FİYAT vardır ve ikisi de gerçektir — nakit/havale tutarı ile kredi kartı tutarı. Kartla ödeyen KART fiyatını öder. ${taksit} ${kural}`
          : `ÖDEME: Yukarıdaki fiyatlar TEK FİYATTIR — nakit, havale ve kredi kartında aynı tutar geçerlidir; nakde özel ayrı bir fiyat YOKTUR. ${taksit} ${kural}`,
      )
    }
    // Remote registration is a CAPABILITY, not a claim — it is true only while a payment provider is
    // live AND links are enabled. Read from the same document the checkout reads, so the assistant can
    // never offer a link the studio cannot actually send. The link itself is minted by a human at the
    // desk against a real sale (a link never attaches itself to a package nobody sold), which is why
    // this ends in a handover rather than a promise.
    const pp = (await database.doc(`studios/${ctx.studioId}/settings/paymentProvider`).get()).data() as
      | { active?: boolean; linkEnabled?: boolean }
      | undefined
    if (pp?.active === true && pp.linkEnabled !== false) {
      parts.push(
        'UZAKTAN KAYIT: Stüdyoya gelmeden de kayıt yapılabilir — yetkilimiz WhatsApp üzerinden güvenli bir ödeme linki gönderir, müşteri kartıyla öder ve üyeliği başlar. Müşteri "linki gönderir misiniz / uzaktan olur mu / kartla ödeyebilir miyim" derse bunu SÖYLE ve hemen [[DEVRET:SATIS]] ile yetkiliye devret; linki SEN oluşturamazsın, söz verip bekletme.',
      )
    }
  } catch (e) {
    logger.warn('[wa-webhook] product facts failed', (e as Error)?.message)
  }
  // ── The schedule is NOT sent to the model (owner, 2026-07-27) ──────────────────────────────
  //
  // This block used to list upcoming classes with free seats. It is gone, and deliberately not
  // replaced with a rule telling the model to keep quiet about it: a model cannot leak what it was
  // never given, and every instruction not to reveal something is a lock that a persuasive enough
  // message eventually picks.
  //
  // Why the owner wants it gone. Availability is not a price list. Saying "Thursday 19:30, two
  // seats" to a stranger on WhatsApp commits a scarce resource the studio has not agreed to give
  // away, tells anyone who asks how full the studio is, and — the case that prompted this —
  // encourages Multisport day-visitors to turn up for a slot nobody actually reserved for them.
  // Seats are held by a HUMAN at the desk, who can see the room and the day.
  return parts.join('\n')
}

// The STABLE half of the system prompt — the studio's knowledge card and the conversational rules.
// It is built WITHOUT the live facts on purpose: this text is what gets prompt-cached (see aiReply),
// and a cache only pays off if the bytes are identical from one call to the next. The live facts —
// which class has a free spot, right now — change between messages and are sent as a separate block
// after it, so they can never invalidate the cached prefix.
function buildSystem(ai: AiSettingsDoc): string {
  const kb: string[] = []
  if (ai.identity) kb.push(`KİMLİK: ${ai.identity}`)
  if (ai.basics) kb.push(`TEMEL BİLGİLER:\n${ai.basics}`)
  if (ai.policies) kb.push(`POLİTİKALAR:\n${ai.policies}`)
  // The campaign goes in the CACHED half deliberately: it changes when the owner edits it, not
  // between messages, so it costs one cache miss per change instead of a full-price block per call.
  if (ai.campaign)
    kb.push(
      `GÜNCEL KAMPANYA (BU DÖNEMİN SATIŞ ÖNCELİĞİ — fiyat konuşulan her sohbette kullan):\n${ai.campaign}\nBuradaki koşulları AYNEN aktar; kendin kampanya, indirim, süre veya kontenjan UYDURMA.`,
    )
  if (ai.faq?.length) kb.push('SIK SORULANLAR:\n' + ai.faq.map((f) => `S: ${f.q}\nC: ${f.a}`).join('\n'))
  if (ai.escalation) kb.push(`İNSANA DEVRET (bu durumlarda escalate=true yap):\n${ai.escalation}`)
  if (ai.neverDo) kb.push(`ASLA YAPMA:\n${ai.neverDo}`)
  if (ai.examples) kb.push(`ÖRNEK ÜSLUP:\n${ai.examples}`)
  return `Sen bir butik, KADINLARA ÖZEL pilates & fitness stüdyosunun WhatsApp resepsiyonistisin. Çoğu kişi Instagram reklamından "bilgi almak istiyorum" diye yazar. Deneyimli, satış-odaklı ama samimi bir çalışan gibi davran.

${ai.tone ? `ÜSLUP: ${ai.tone}\n` : ''}
${kb.join('\n\n')}

NASIL KONUŞ (akış):
0) SOHBETİN İLK mesajındaysan (senden önce assistant mesajı yoksa): sıcak karşıla, hoş geldin de, kısaca STÜDYO olarak tanıt ve — MÜŞTERİNİN ADINI BİLMİYORSAN — çağrı merkezi gibi kibarca ismini sor. Kendini STÜDYONUN KENDİSİ gibi tanıtma ("… by Işıl'ım" DEME) — stüdyo adına yazan bir resepsiyon görevlisisin. Ör: "Merhaba, hoş geldiniz 🌸 <stüdyo adı> resepsiyonundan yazıyorum. Size nasıl hitap edeyim, isminizi öğrenebilir miyim? 🌸". İsmini öğrenince sonraki mesajlarda ismiyle + "Hanım" diye hitap et (ör. "Ayşe Hanım"). "hanımcım" ASLA DEME — fazla samimi kaçıyor (owner, 2026-07-31). Müşteri ismini vermek istemezse ISRAR ETME, bir daha sorma; "hanımefendi" diye hitap et. Sonraki mesajlarda tekrar tanıtma. "Ben botum/yapay zekayım" DEME; doğal, insan gibi ol. Yalnızca doğrudan "bot musun / gerçek misin" diye sorulursa dürüst ol ve [[DEVRET]] ekle. Bu İLK mesajda SADECE karşıla + kısa tanıt + isim sor; "Başka bir sorunuz var mı / yetkilimize aktarayım mı" gibi bir KAPANIŞ/AKTARMA cümlesi EKLEME — daha ortada bir soru yok, aktarılacak bir şey yok, ekleyince saçma duruyor. Müşteri ismini verince (ör. "Melike ismim") ISIMLE DEVAM ET: kısa bir "Memnun oldum Melike hanım 🌸" + hemen 1. adıma geç (hedefini/niyetini sor). İsim aldın diye ASLA susma, sohbeti bitirme veya devretme.
1) Sıcak karşıla, tek bir kısa soruyla NİYETİNİ/HEDEFİNİ öğren (ör. "kilo verme mi, sıkılaşma mı, pilates mi fitness mi düşünüyorsunuz? 🌸"). Baştan uzun fiyat listesi yağdırma.
2) Hedefine göre YÖNLENDİR: uygun hizmeti (pilates / fitness) öner, faydalarını 1-2 cümle anlat. Müşteri HEM pilates HEM fitness ile ilgileniyorsa İKİ AYRI DURUM vardır, karıştırma:
   (a) FİYAT/BİLGİ istiyorsa ("her ikisinin de fiyatını istiyorum", "ikisinin fiyatları nedir", "pilates ve fitness ne kadar") → ÖNCE İKİSİNİ AYRI AYRI LİSTELE (pilates paketleri + fitness paketleri, CANLI VERİ'den), SONRA "isterseniz ikisini birleştiren hibrit paketlerimiz de var" diyip hibritleri ver. Müşteri karşılaştırma yapmak istiyor; sadece hibrit vermek sorduğu soruyu cevaplamamaktır.
   (b) İKİSİNİ BİRLİKTE YAPMAK istiyorsa ("ikisini birden yapmak istiyorum", "haftada 2 gün şu 1 gün bu") → HİBRİT (demet) paketini öner. KENDİN kombinasyon/indirim UYDURMA, fiyatı GÜNCEL PAKETLER listesinden ver (ör. "Hibrit Aylık — 2 Pilates + 1 Fitness").
2.5) HİZMET SORULDUĞUNDA ÖNCE İÇERİĞİ ANLAT, SONRA FİYAT. "Fitness hakkında bilgi almak istiyorum" / "pilates nasıl" gibi bir soruya kuru fiyat listesiyle cevap VERME — önce BİLGİ KARTINDAKİ "HİZMET İÇERİKLERİ" bölümünden o hizmetin nasıl işlediğini anlat: ilk gün ne oluyor (ölçüm, hedef görüşmesi, kişiye özel program), günlük kullanımı nasıl (fitness sınırsız/rezervasyonsuz, pilates uygulamadan randevu + 6 saat iptal), takip nasıl yapılıyor. Yeni başlayana GÜVEN VER ("hiç yapmamış olsanız bile çekinmeyin, emin ellerdesiniz"). Bunu 4-8 satırlık, maddeli ve SICAK bir anlatımla yap — tek cümleyle geçiştirme. Fiyatı bu anlatımın SONUNDA ver, ya da müşteri özellikle fiyat sorduysa anlatımın ardından ekle.
3) İlgi varsa FİYAT ver (CANLI VERİ bölümündeki listeden, ASLA uydurma). Müşteri hangi hizmetin fiyatını sorduysa ONU ver — sorulmayanı listeleme; ikisini birden sorduysa 2(a)'daki sıraya uy (önce ayrı ayrı, sonra hibrit alternatifi). DENEME DERSİMİZ YOK — bunun yerine "gelip stüdyoyu görmeye / tanışmaya" davet ederek kapat.
3.5) SATIŞ YAP — fiyatı verip bırakma. Fiyatı verdikten sonra MUTLAKA bir sonraki adımı öner ve karar sorusuyla kapat (ör. "size hangisi daha uygun geldi? 🌸", "isterseniz sizin için yerinizi ayıralım"). GÜNCEL KAMPANYA bölümü doluysa öne çıkardığı paketi ÖNCE ve GEREKÇESİYLE anlat (aylık maliyeti en düşük olan, ödeme kolaylığı olan), diğerlerini alternatif olarak ver. Kampanyanın koşullarını (taksit, süre, kontenjan) O BÖLÜMDE YAZDIĞI GİBİ söyle — abartma, kendin aciliyet uydurma. Müşteri "düşüneyim" derse ısrar etme; kapıyı açık bırak ve kampanyanın koşulunu bir kez hatırlat.
4) Bir konuyu YANITLADIKTAN sonra sohbeti doğal biçimde açık tut (ör. "Başka merak ettiğin bir şey var mı? 🌸"). "Yetkilimize aktarayım mı" cümlesini HER mesaja EKLEME; bunu SADECE müşteri bir insan/yetkili isterse ya da sen yardımcı olamıyorsan söyle. İlk selamda, isim sorarken veya müşteri aktif soru sorarken aktarma teklif etme.
5b) Müşteri ÖPÜCÜK/KALP gönderirse (😘 🥰 ❤️ ya da "öptüm"): AYNISINI GERİ YAPMA. "öptük", "öperim" DEME — stüdyo adına yazıyorsun, samimiyeti karşılamak başka, aynı seviyede karşılık vermek başkadır (owner, 2026-07-31). Kısa ve sıcak bir teşekkür yeter: "Rica ederiz hanımefendi 🌸 kendinize iyi bakın 💛".
5) Müşteri TEŞEKKÜR eder ya da VEDALAŞIRSA ("teşekkür ederim", "sağ olun", "eyvallah", "görüşürüz") ASLA sessiz kalma; sıcak, kısa bir KAPANIŞ yaz. Ör: "Rica ederiz, asıl biz teşekkür ederiz 🌸 Görüşmek üzere, kendinize iyi bakın 💛" ya da "Ne demek, her zaman bekleriz 🌸". Ardından yine gelmeye/tanışmaya davetle kapatabilirsin.

KURALLAR:
- HER mesaja MUTLAKA müşteriye gidecek en az bir cümle yaz — görünür mesajı ASLA boş bırakma. Kısa bir mesaj bile ("Rica ederiz 🌸") boş kalmaktan iyidir.
- SADECE bu bilgi kartından ve CANLI VERİ bölümünden konuş. Fiyat/program/tarih UYDURMA. Bilmiyorsan escalate=true.
- DERS PROGRAMI / MÜSAİT SAAT BİLGİSİ VERME — İSTİSNASIZ. Hangi gün hangi saatte ders var, hangi seansta yer var, doluluk ne kadar, kaç kişi kaldı: HİÇBİRİNİ söyleme. Müşteri ısrar etse de, başka bir soruyu cevaplarken bile olsa, tahmin ederek bile olsa verme. Zaten sende bu bilgi YOK — uydurma. Bunun yerine: "Uygun saatleri ve yer durumunu resepsiyonumuz gün içinde netleştiriyor; hangi saatler size uyuyor yazarsanız kontrol edip dönelim 🌸" de. Yer/saat kesinleştirme isteği gelirse escalate=true.
- Kısa, samimi, Türkçe, ölçülü emoji. Tek mesajda çok soru sorma.
- DOĞAL karşıla: gelen mesaja uygun cevap ver. Müşteri sana "merhaba/hoş geldin" demediyse "siz de hoş geldiniz" gibi karşılık verme; "Merhaba 🌸" yeter. Refleks nezaket kalıpları kullanma, robotik olma.
- Kadınlara özel stüdyoyuz: "kız" DEME, her zaman "kadın" de.
- Devretmen gerekince kişi ADI verme ("Işıl'a aktarayım" DEME) ve "hoca / hocamız / yetiştiricimiz" gibi bir unvanla da ANMA; SADECE "sizi yetkilimize aktarıyorum" de.
- DENEME DERSİ YOK. "İlk ders ücretsiz / deneme dersi" gibi bir şey ASLA söyleme; sadece "gelip görebilirsiniz / tanışabiliriz" de.
- Kesin taahhüt (rezervasyon/ödeme) verme → escalate=true.
- Müşteri "insanla/yetkiliyle görüşmek istiyorum" derse ya da şikayet/iade/sağlık/pazarlık olursa → devret.

ÇIKTI BİÇİMİ (ÇOK ÖNEMLİ — yanlış olursa müşteriye sızıyor):
Önce SADECE müşteriye gidecek mesajı düz metin yaz. Ardından, SADECE gerekiyorsa, aşağıdaki gizli satırları TAM OLARAK bu formatta ekle. Bunları AYIRMAK için "---" veya başka ayraç KULLANMA; parantez içinde serbest not YAZMA:
- Devretmek GERÇEKTEN gerekiyorsa (müşteri insan/yetkili ister, şikayet/iade/sağlık/pazarlık, ya da yanıtlayamıyorsan) ayrı satır: [[DEVRET]]. Selam, tanışma, isim sorma, normal bilgi/fiyat sorularında ASLA [[DEVRET]] yazma.
- SICAK DEVİR (YENİ, ÇOK ÖNEMLİ): Müşteri ALMAYA HAZIR sinyali verdiğinde de [[DEVRET]] yaz. Sinyaller: "hangi paket bana uygun / nasıl kayıt olurum / kayıt yaptırmak istiyorum / ne zaman başlayabilirim / yarın gelebilir miyim / yer var mı / ödeme nasıl / taksit olur mu / linki gönderir misiniz / düşüneyim dönerim değil, tamam" gibi ilerleme isteyen her ifade. Bu durumda önce KISA bir cevap yaz ve şu şekilde kapat: "Size en uygun paketi birlikte seçelim hanımefendi 🌸 Hemen yetkilimiz buradan yazacak, birkaç dakika içinde döneceğiz." Sonra ayrı satıra [[DEVRET:SATIS]] koy (sorun devrinde düz [[DEVRET]], satış devrinde [[DEVRET:SATIS]]). Sohbeti KESME, veda etme, "iyi günler" deme — kişi hatta kalsın, yetkili aynı sohbete yazacak. Bu devir bir sorun işareti DEĞİLDİR: satışa hazır bir kişiyi insana teslim etmektir ve geciktirilirse müşteri kaybedilir.
- Skor için ayrı satır, TAM olarak şu formatta: ##SKOR: sıcak | tek satır gerekçe  (sıcak=çok ilgili/fiyat sordu/gelmek istiyor · ılık=ilgili ama kararsız · soğuk=ilgisiz/kısa). Bu satırı "##SKOR:" ile başlatMAZSAN sistem gizleyemez ve müşteri görür — bu yüzden ayracsız, tam bu formatta yaz.`
}

// Plain-text reply (robust — Haiku often ignores a JSON instruction and answers naturally). Escalation
// rides as a trailing [[DEVRET]] marker we strip before sending; the customer never sees it.
type Temp = 'sıcak' | 'ılık' | 'soğuk'
async function aiReply(
  apiKey: string,
  system: string,
  facts: string,
  history: Msg[],
): Promise<{ reply: string; escalate: boolean; hot: boolean; temp: Temp | null; reason: string } | null> {
  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1024,
        // Thinking OFF, effort LOW — and both are load-bearing, not tuning. Sonnet 5 thinks by
        // default (Haiku did not), which pushed replies past the timeout below: three customers got
        // no answer at all on the day of the switch. This is receptionist small talk — a price, an
        // address, a class time — not a problem that rewards deliberation, and a fast good answer
        // beats a slow better one when someone is waiting in a WhatsApp thread.
        thinking: { type: 'disabled' },
        output_config: { effort: 'low' },
        // TWO system blocks, and the order is the whole point. The studio's knowledge card is ~3.000
        // tokens and identical on every call, so it is cached: after the first message of a
        // conversation the follow-ups bill it at a tenth of the price. The live facts come AFTER the
        // cache breakpoint because they change between messages (a class fills up, a slot passes) —
        // in front of it, they would invalidate the cache on every single call and it would cost more
        // than it saves.
        system: [
          { type: 'text', text: system, cache_control: { type: 'ephemeral' } },
          ...(facts ? [{ type: 'text', text: `— CANLI VERİ —\n${facts}` }] : []),
        ],
        messages: history.map((m) => ({ role: m.role, content: m.text })),
      }),
      // Was 15s. A reply that arrives after this is not just late — it is DISCARDED, and the customer
      // is left on read with no trace except a warning in the log.
      signal: AbortSignal.timeout(25_000),
    })
    if (!res.ok) {
      logger.warn('[wa-webhook] anthropic', res.status)
      return null
    }
    const data = (await res.json()) as { content?: { text?: string }[] }
    const text = data.content?.[0]?.text
    if (!text) return null
    const escalate = /\[\[?\s*DEVRET/i.test(text)
    // A handover because she is READY TO BUY is a different event from one because something went
    // wrong, and the desk must be able to tell them apart at a glance: one is a sale waiting, the
    // other is a problem waiting. Same marker, one suffix — the scrubber below already removes
    // anything beginning `[[DEVRET`, so neither form can reach the customer.
    const hot = /\[\[?\s*DEVRET\s*:\s*SATIS/i.test(text)
    // Parse the hidden ##SKOR: <sıcak|ılık|soğuk> | <reason> line.
    const scoreLine = text.match(/##\s*SKOR\s*:\s*(sıcak|ılık|soğuk)\s*(?:\|\s*(.*))?/i)
    const temp = (scoreLine?.[1]?.toLocaleLowerCase('tr') as Temp | undefined) ?? null
    const reason = (scoreLine?.[2] ?? '').trim()
    // The VISIBLE message is everything before the hidden section. The model separates it
    // inconsistently — a "---" line, a "##SKOR" line, or a "[[DEVRET" — so cut at the EARLIEST such
    // marker (otherwise a mis-formatted score line like "--- (kişi kimliği belirsiz)" leaks to the
    // customer), then scrub any stray [[DEVRET]] token and lone "(reason)" lines the model leaks.
    const cut = [/\n\s*-{3,}\s*(?:\n|$)/, /##\s*SKOR/i, /\[\[?\s*DEVRET/i]
      .map((re) => text.search(re))
      .filter((i) => i >= 0)
    const reply = text
      .slice(0, cut.length ? Math.min(...cut) : text.length)
      .replace(/\[\[?\s*DEVRET[^\]]*\]?\]?/gi, '')
      .replace(/^\s*\([^)]*\)\s*$/gm, '')
      .trim()
    if (!reply) return null
    return { reply, escalate, hot, temp, reason }
  } catch (e) {
    logger.warn('[wa-webhook] anthropic failed', (e as Error)?.message)
    return null
  }
}

async function processMessage(sid: string, from: string, name: string, text: string, msgId: string): Promise<void> {
  const database = db()
  const ctx = ctxOf(sid)
  const ref = database.doc(`studios/${sid}/conversations/${from}`)
  const snap = await ref.get()
  const isNew = !snap.exists
  const conv = (snap.data() as Conversation | undefined) ?? { phone: from, name, status: 'ai', needsAttention: false, lastAt: 0, seenIds: [], messages: [] }
  if (conv.seenIds.includes(msgId)) return // idempotent: Meta retries the same message id

  // FIRST contact → record the lead in the CRM funnel (existing lead.captured event, no schema change).
  // The AI is a system principal (#5); a lead whose name we don't have yet gets a phone-tail placeholder.
  if (isNew) {
    try {
      const correlationId = newCorrelationId()
      const now = instant(Date.now())
      const lead: Lead = {
        id: `led_${correlationId.slice(4)}`,
        studioId: ctx.studioId,
        branchId: null,
        fullName: name || `WhatsApp ${from.slice(-4)}`,
        phone: from,
        email: null,
        source: 'instagram',
        sourceDetail: 'WhatsApp AI',
        stage: 'new',
        ownerStaffId: null,
        createdAt: now,
        createdBy: ctx.actor,
        lostReason: null,
        lostNote: null,
        convertedMemberId: null,
        closedAt: null,
        note: null,
      }
      const decided = decideCaptureLead({ studioId: ctx.studioId, actor: ctx.actor, now, correlationId, source: 'whatsapp_ai' }, lead)
      if (decided.ok) await new FirestoreCrmRepository(database).saveLead(ctx, decided.value.next, decided.value.events)
    } catch (e) {
      logger.warn('[wa-webhook] lead capture failed', (e as Error)?.message)
    }
  }

  const now = Date.now()
  conv.name = conv.name || name
  conv.messages = [...conv.messages, { role: 'user' as Role, text, at: now }].slice(-MAX_HISTORY)
  conv.seenIds = [...conv.seenIds, msgId].slice(-30)
  conv.lastAt = now

  const aiDoc = (await database.doc(`studios/${sid}/settings/ai`).get()).data() as AiSettingsDoc | undefined
  const active = Boolean(aiDoc?.whatsappActive)
  const apiKey = process.env.ANTHROPIC_API_KEY
  const token = process.env.WHATSAPP_ACCESS_TOKEN
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID

  // AI replies only when: the master switch is ON, the conversation isn't already with a human, and the
  // keys are present. Otherwise the message is just stored + flagged for the desk.
  if (!active || conv.status === 'human' || !apiKey || !token || !phoneId || !aiDoc) {
    conv.needsAttention = true
    await ref.set(conv, { merge: true })
    logger.info('[wa-webhook] stored, no auto-reply', { sid, active, status: conv.status })
    return
  }

  const facts = await liveFacts(database, ctx)
  const system = buildSystem(aiDoc)
  const result = await aiReply(apiKey, system, facts, conv.messages)
  if (!result) {
    conv.needsAttention = true
    conv.attentionReason = 'ai_failed'
    await ref.set(conv, { merge: true })
    return
  }

  const config: MetaWhatsAppConfig = { phoneNumberId: phoneId, accessToken: token, ...(process.env.WHATSAPP_API_VERSION ? { apiVersion: process.env.WHATSAPP_API_VERSION } : {}) }
  const sent = await sendWhatsAppText(config, from, result.reply)
  conv.messages = [...conv.messages, { role: 'assistant' as Role, text: result.reply, at: Date.now() }].slice(-MAX_HISTORY)
  if (result.temp) {
    conv.temp = result.temp
    conv.reason = result.reason
  }
  // Devret (escalation) only FLAGS the desk (green "operatör devri geliyor" alert). It no longer silences
  // the AI: the assistant KEEPS answering so the customer is never left hanging, until a human actually
  // takes over — the operator clicking "Devral" or replying is what flips status to 'human' (owner).
  if (result.escalate) {
    conv.needsAttention = true
    conv.attentionReason = result.hot ? 'hot_lead' : 'handoff'
    // The desk alert only reaches a browser that is open. A person ready to buy at 21:40 is the
    // exact case where nobody is looking at one, and she is also the case where waiting until
    // tomorrow loses the sale — so this one leaves the building.
    if (result.hot) await tellTheDesk(sid, conv, from)
  }
  await ref.set(conv, { merge: true })
  logger.info('[wa-webhook] replied', { sid, escalate: result.escalate, sent: sent.ok })
}

// ── Getting a hot lead to a human, off the screen ────────────────────────────────────────────
//
// The desk already has an alert for a handover — a green toast in the panel. It works, and it only
// works while a browser is open on it. The person who says "kayıt olmak istiyorum" at 21:40 is
// precisely the one nobody is looking at a browser for, and precisely the one who is gone by
// morning: she was ready, the moment passed, and the call the next afternoon is a cold call.
//
// So a SALES handover leaves the building through the ordinary notification pipeline — the same one
// the studio already uses for members. Channels are tried in order, so this reaches whatever is
// actually configured today (in-app + e-mail) and starts reaching WhatsApp the day the studio's
// template is approved, with no code change.
//
// Best-effort, always: failing to notify must never cost the customer her reply. The AI has already
// answered her by this point.
async function tellTheDesk(sid: string, conv: Conversation, phone: string): Promise<void> {
  try {
    const ctx = ctxOf(sid)
    const staff = await new FirestoreIdentityRepository(db()).listStaff(ctx)
    const desk = staff.filter((m) => m.active && (m.role === 'owner' || m.role === 'receptionist'))
    if (desk.length === 0) return

    const deps = notificationDeps(await studioNotificationSettings(ctx.studioId))
    // The last thing SHE said. It is what tells whoever picks this up whether to quote a package or
    // open the door — and it saves them opening the panel to find out.
    const lastFromHer = [...conv.messages].reverse().find((m) => m.role === 'user')?.text ?? ''

    for (const person of desk) {
      let email: string | null = null
      try {
        email = (await getAuth().getUser(person.id as string)).email ?? null
      } catch {
        /* no auth account — in-app still reaches them */
      }
      await notify(deps, ctx, {
        // One alert per conversation per hour: she may send three messages in a row, and three
        // identical alarms are how an alarm stops being read.
        intentId: `hotlead-${phone}-${Math.floor(Date.now() / 3_600_000)}-${person.id}`.slice(0, 180),
        eventId: null,
        eventType: 'crm.hot_lead',
        operationId: newCorrelationId(),
        templateId: 'lead_handoff',
        recipient: { kind: 'staff', id: person.id as string, email, phone: null, displayName: person.displayName },
        params: {
          leadName: conv.name || `WhatsApp ${phone.slice(-4)}`,
          leadPhone: phone,
          lastMessage: lastFromHer.slice(0, 200),
        },
      })
    }
  } catch (e) {
    logger.warn('[wa-webhook] hot lead alert failed', (e as Error)?.message)
  }
}

// Admin one-shot (owner): hand EVERY conversation back to the AI and let it answer the ones that are
// waiting. "Waiting" = the last message is from the customer (a human message with no reply after it);
// where the last message is the AI's own, nothing is pending so we leave it. Token-protected.
async function resumeAll(sid: string): Promise<{ resumed: number; replied: number; total: number }> {
  const database = db()
  const ctx = ctxOf(sid)
  const aiDoc = (await database.doc(`studios/${sid}/settings/ai`).get()).data() as AiSettingsDoc | undefined
  const apiKey = process.env.ANTHROPIC_API_KEY
  const token = process.env.WHATSAPP_ACCESS_TOKEN
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID
  if (!aiDoc?.whatsappActive || !apiKey || !token || !phoneId) return { resumed: 0, replied: 0, total: 0 }

  const facts = await liveFacts(database, ctx)
  const system = buildSystem(aiDoc)
  const config: MetaWhatsAppConfig = { phoneNumberId: phoneId, accessToken: token, ...(process.env.WHATSAPP_API_VERSION ? { apiVersion: process.env.WHATSAPP_API_VERSION } : {}) }

  const convs = await database.collection(`studios/${sid}/conversations`).get()
  let resumed = 0
  let replied = 0
  for (const doc of convs.docs) {
    const conv = doc.data() as Conversation
    let changed = false
    if (conv.status === 'human') {
      conv.status = 'ai'
      resumed++
      changed = true
    }
    const last = conv.messages[conv.messages.length - 1]
    if (last?.role === 'user') {
      const result = await aiReply(apiKey, system, facts, conv.messages)
      if (result) {
        await sendWhatsAppText(config, conv.phone, result.reply)
        conv.messages = [...conv.messages, { role: 'assistant' as Role, text: result.reply, at: Date.now() }].slice(-MAX_HISTORY)
        if (result.temp) {
          conv.temp = result.temp
          conv.reason = result.reason
        }
        conv.needsAttention = result.escalate // AI handled it; only flag the desk if it wants a human
        replied++
        changed = true
      }
    } else if (changed) {
      conv.needsAttention = false // taken back by the AI, nothing pending
    }
    if (changed) await doc.ref.set(conv, { merge: true })
  }
  return { resumed, replied, total: convs.size }
}

export const whatsappWebhook = onRequest({ region: REGION, secrets: [...AI_RECEPTIONIST_SECRETS] }, async (req, res) => {
  const sid = (req.path ?? '').replace(/^\/+/, '').split('/')[0] || 'retro'

  // ── POST admin one-shot: hand all conversations back to the AI + answer the waiting ones ──
  if (req.method === 'POST' && req.query.admin === 'resume' && req.query.token === process.env.WHATSAPP_VERIFY_TOKEN) {
    const out = await resumeAll(sid)
    res.status(200).json(out)
    return
  }

  // ── GET: Meta verification handshake ──
  if (req.method === 'GET') {
    const mode = req.query['hub.mode']
    const token = req.query['hub.verify_token']
    const challenge = req.query['hub.challenge']
    if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
      res.status(200).send(String(challenge ?? ''))
      return
    }
    res.status(403).send('forbidden')
    return
  }

  // ── POST: inbound messages ──
  try {
    const body = (typeof req.body === 'object' ? req.body : JSON.parse(req.rawBody?.toString('utf8') || '{}')) as {
      entry?: { changes?: { value?: { contacts?: { profile?: { name?: string }; wa_id?: string }[]; messages?: { from?: string; id?: string; type?: string; text?: { body?: string } }[] } }[] }[]
    }
    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const value = change.value ?? {}
        const nameByWa = new Map<string, string>()
        for (const c of value.contacts ?? []) if (c.wa_id) nameByWa.set(c.wa_id, c.profile?.name ?? '')
        for (const m of value.messages ?? []) {
          if (m.type !== 'text' || !m.from || !m.id || !m.text?.body) continue
          await processMessage(sid, m.from, nameByWa.get(m.from) ?? '', m.text.body, m.id)
        }
      }
    }
  } catch (e) {
    logger.error('[wa-webhook] POST failed', (e as Error)?.message ?? e)
  }
  // Always 200 so Meta doesn't storm retries; failures are logged + surfaced to the desk.
  res.status(200).send('OK')
})
