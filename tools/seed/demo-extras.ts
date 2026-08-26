// DEMO STÜDYOSU — FAZ 5-8: WhatsApp/lead hunisi, AI, antrenman, turnike.
//
//   FIREBASE_PROJECT_ID=studio-yonetim-prod pnpm tsx tools/seed/demo-extras.ts          (kuru)
//   FIREBASE_PROJECT_ID=studio-yonetim-prod pnpm tsx tools/seed/demo-extras.ts --apply
//
// `demo-studio.ts` işletmenin İSKELETİNİ kuruyor: üye, paket, ajanda, doluluk. Bu script ürünün
// ANLATTIĞI şeyi kuruyor — aracının bakınca "bunu neden alayım" sorusuna cevap bulacağı yer.
// Ayrı dosya çünkü ikisi birbirine bağlı değil: iskelet dururken bu kısım tek başına yeniden
// çalıştırılabilir, ve tek başına yanlış giderse iskeleti yeniden kurmak gerekmez.
//
// NE SEEDLENEBİLİR, NE SEEDLENEMEZ. Bunu ölçtük, varsaymadık:
//   • `settings/ai` (bilgi kartı) — saf ayar, LLM yok. Yazılır.
//   • `conversations` — düz doküman. `/ai-report` hunisi bunlardan CANLI hesaplanıyor, saklı bir
//     rapor dokümanı yok; yani sohbetleri yazmak raporu da doldurur.
//   • `settings/patronBriefing` — haftanın anahtarı tutarsa Anthropic çağrısını tamamen atlıyor.
//     API anahtarı olmadan da gerçek bir brifing görünür.
//   • `settings/aiChecklist` — YAZILMIYOR, kasten. O bir önbellek: içindeki her satırın id'si canlı
//     advisor id'siyle eşleşmezse istemci onu düşürüyor. Checklist zaten altındaki sinyallerden
//     (açık bakiye, bitmek üzere paket, boş seans, sıcak lead) kendiliğinden doluyor — ki o sinyaller
//     iskelette ve burada gerçekten var. Uydurma bir önbellek, gerçek listeyi taklit etmez.
//   • `/patron` sohbeti ve AI program TASLAĞI — her soruda canlı LLM. Seedlenemez; onun yerine
//     kabul edilmiş programı (`programs`, notu "AI önerisi") yazıyoruz.
//
// GÜVENLİK. `lockToStudio` yüzünden `studios/demo/` dışındaki her yol — okuma dahil — veritabanına
// ulaşmadan çöküyor.
import {
  FirestoreCrmRepository,
  FirestoreTrainingRepository,
  createProgram,
  changeProgramStatus,
  decideCaptureLead,
  decideLogInteraction,
  decideLoseLead,
  decideMoveStage,
  instant,
  newCorrelationId,
  publishProgramVersion,
  recordMeasurement,
  systemClock,
  upsertExercise,
  type ActorRef,
  type BranchId,
  type DraftProgramDay,
  type Interaction,
  type Lead,
  type LeadStage,
  type MemberId,
  type StaffUserId,
  type StudioId,
  type TenantContext,
  type TrainingDeps,
} from '@studio/core'
import { initializeApp } from 'firebase-admin/app'
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore'

import { lockToStudio } from './demo-guard'

const STUDIO = 'demo' as StudioId
const BRANCH = 'merkez' as BranchId
const APPLY = process.argv.includes('--apply')
const DAY = 86_400_000
const OWNER = 'usr_demo_owner' as StaffUserId

const ctx: TenantContext = {
  studioId: STUDIO,
  branchIds: [BRANCH],
  role: 'owner',
  actor: { type: 'owner', id: OWNER } as ActorRef,
}

let tohum = 8_260_826
const rnd = () => ((tohum = (tohum * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
const arasi = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1))
const sec = <T>(a: readonly T[]): T => a[Math.floor(rnd() * a.length)] as T

/** Stüdyo yerel tarihi (Europe/Istanbul) — hafta anahtarı ve LocalDate alanları için. */
const trTarih = (ms: number) => new Date(ms + 3 * 3_600_000).toISOString().slice(0, 10)

/** Bu haftanın PAZARTESİ'si — `settings/patronBriefing` önbelleğinin anahtarı. */
function haftaAnahtari(ms: number): string {
  const d = new Date(ms + 3 * 3_600_000)
  const gun = d.getUTCDay() // 0 pazar
  const pzt = ms - ((gun + 6) % 7) * DAY
  return trTarih(pzt)
}

function ok<T>(r: { ok: true; value: T } | { ok: false; error: unknown }, ne: string): T {
  if (!r.ok) throw new Error(`${ne}: ${JSON.stringify(r.error)}`)
  return r.value
}

async function main(): Promise<void> {
  initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID ?? 'studio-yonetim-prod' })
  const db = lockToStudio(getFirestore(), STUDIO)

  console.log(APPLY ? '── UYGULANIYOR ──' : '── KURU ÇALIŞMA (hiçbir şey yazılmaz) ──')
  console.log(`Stüdyo: ${STUDIO} (kilit aktif — bu id dışına yazılamaz)\n`)

  const uyeSnap = await db.collection(`studios/${STUDIO}/members`).get()
  if (uyeSnap.empty) {
    console.log('Demo stüdyosunda üye yok. Önce iskeleti kur:')
    console.log('  pnpm tsx tools/seed/demo-studio.ts --apply')
    process.exit(1)
  }
  const uyeler = uyeSnap.docs.map((d) => ({
    id: d.id as MemberId,
    ad: String(d.data().fullName ?? ''),
    // `/ai-report`'un "dönüştü" sütunu, sohbet telefonunun RAKAMLARINI üyenin telefonuyla
    // karşılaştırıyor. Uydurmak yerine üyenin kendi kayıtlı numarasından üretiyoruz — eşleşme
    // tesadüfe kalmaz.
    rakam: String(d.data().phoneNormalized ?? d.data().phone ?? '').replace(/\D/g, ''),
  }))
  console.log(`${uyeler.length} üye bulundu.\n`)

  if (!APPLY) {
    console.log('Yazılacaklar: WhatsApp sohbetleri · leadler · görüşmeler · AI bilgi kartı')
    console.log('              patron brifingi · egzersiz kütüphanesi · programlar · ölçümler')
    console.log('              turnike cihazı · turnike geçiş geçmişi')
    console.log('\nUygulamak için --apply')
    process.exit(0)
  }

  const now = Date.now()
  // CRM'de uygulama katmanı yok — kararlar `decide*`, yazma `repo` üzerinden. Antrenmanda ise
  // tam bir uygulama katmanı var, onu kullanıyoruz.
  const crmRepo = new FirestoreCrmRepository(db)
  const trainDeps: TrainingDeps = { repo: new FirestoreTrainingRepository(db), clock: systemClock }

  // ── 5 · WhatsApp sohbetleri ────────────────────────────────────────────────────────────────
  // Ürünün en çok konuşulan parçası. Bir sohbet ancak `lastAt` varsa listede görünür (her sorgu
  // onunla sıralanıyor) ve ancak en az bir `role:'user'` mesajı varsa AI raporunun hunisine girer.
  //
  // `temp` değerleri Türkçe ve harfleri önemli: `sıcak`/`ılık` noktasız ı ile. Yanlış harf sessizce
  // "renk yok"a düşer — bu yüzden sabit olarak yazılıyorlar, elle her seferinde değil.
  const SICAK = 'sıcak' as const
  const ILIK = 'ılık' as const
  const SOGUK = 'soğuk' as const

  type Msg = { role: 'user' | 'assistant'; text: string; at: number }
  const sohbet = async (v: {
    rakam: string
    ad: string
    gunOnce: number
    temp: typeof SICAK | typeof ILIK | typeof SOGUK
    reason: string
    status: 'ai' | 'human'
    dikkat?: 'handoff' | 'ai_failed' | 'hot_lead'
    mesajlar: readonly (readonly [Msg['role'], string])[]
  }) => {
    const basla = now - v.gunOnce * DAY
    // Mesajlar birkaç saate yayılıyor: aynı milisaniyede biten bir sohbet gerçek görünmüyor ve
    // AI raporunun "kaç ayrı gün" sayacı da bunu okuyor.
    const mesajlar: Msg[] = v.mesajlar.map(([role, text], i) => ({
      role,
      text,
      at: basla + i * arasi(4, 90) * 60_000,
    }))
    const son = mesajlar[mesajlar.length - 1]?.at ?? basla
    await db.doc(`studios/${STUDIO}/conversations/${v.rakam}`).set({
      phone: v.rakam,
      name: v.ad,
      status: v.status,
      needsAttention: v.dikkat != null,
      ...(v.dikkat ? { attentionReason: v.dikkat } : {}),
      lastAt: son,
      seenIds: [],
      messages: mesajlar,
      temp: v.temp,
      reason: v.reason,
    })
  }

  // Dönüşen sohbetler: telefon gerçek bir üyeninki, yani huni "yazdı → ilgilendi → dönüştü" diyor.
  await sohbet({
    rakam: uyeler[3]!.rakam, ad: uyeler[3]!.ad, gunOnce: 12, temp: SICAK, status: 'ai',
    reason: 'Fiyat sordu, deneme dersine geldi, paketi aldı.',
    mesajlar: [
      ['user', 'Merhaba, reformer pilates için bilgi alabilir miyim?'],
      ['assistant', 'Merhaba! 🌸 Reformer Pilates derslerimiz 50 dakika ve grupta en fazla 8 kişi oluyoruz. 8 derslik paketimiz 4.800 TL, 16 derslik paketimiz 8.800 TL. Hangi saatler size uygun?'],
      ['user', 'Sabahları müsaitim. Hiç pilates yapmadım, başlangıç için uygun mu?'],
      ['assistant', 'Kesinlikle uygun 🙂 Sabah 09:00 ve 10:00 seanslarımız var. İlk dersinizde eğitmenimiz sizinle birebir ilgilenir, hiç deneyimi olmayan üyelerimizin çoğu oradan başlıyor. Deneme dersi ayarlayalım mı?'],
      ['user', 'Olur, çarşamba sabah gelebilirim'],
      ['assistant', 'Harika! Çarşamba 09:00 için yerinizi ayırdım. Rahat bir tayt ve çorap yeterli 🧦 Görüşmek üzere!'],
      ['user', 'Geldim çok beğendim, 8 derslik paketi almak istiyorum'],
      ['assistant', 'Ne güzel! 🎉 Resepsiyondaki arkadaşımız hemen kaydınızı açıyor. Aramıza hoş geldiniz!'],
    ],
  })
  await sohbet({
    rakam: uyeler[11]!.rakam, ad: uyeler[11]!.ad, gunOnce: 26, temp: SICAK, status: 'ai',
    reason: 'Fitness + pilates birlikte istedi, hibrit paketi aldı.',
    mesajlar: [
      ['user', 'Fitness üyeliği ile pilatesi birlikte kullanabiliyor muyum?'],
      ['assistant', 'Evet 💪 Fitness üyeliği serbest giriş sağlıyor, pilates dersleri ise ayrı bir paket. İkisini birlikte alan üyelerimiz için avantajlı bir kombinasyonumuz var — detayını resepsiyonda paylaşalım mı?'],
      ['user', 'Paylaşın lütfen'],
      ['assistant', 'Bugün 17:00\'den sonra uygun musunuz? Size özel fiyatı yüz yüze konuşalım.'],
      ['user', 'Uygunum, geliyorum'],
    ],
  })

  // Sıcak ama HENÜZ dönüşmemiş — panelin "Bugün ilgilenmen gerekenler" listesindeki asıl iş bu.
  await sohbet({
    rakam: '905321440118', ad: 'Nihan Ç.', gunOnce: 1, temp: SICAK, status: 'human',
    dikkat: 'handoff', reason: 'Kurumsal indirim istedi — fiyat yetkisi resepsiyonda değil.',
    mesajlar: [
      ['user', 'Merhaba, şirketimizden 6 kişi düşünüyoruz. Toplu indirim var mı?'],
      ['assistant', 'Merhaba! 6 kişilik bir grup için kesinlikle özel bir fiyat çıkarabiliriz 🙂 Bu konuyu stüdyo sahibimize aktarıyorum, en kısa sürede size dönecek.'],
      ['user', 'Teşekkürler, bugün içinde dönebilir misiniz? Yönetime sunacağım'],
    ],
  })
  await sohbet({
    rakam: '905331229074', ad: 'Ayça Ünal', gunOnce: 2, temp: SICAK, status: 'ai',
    dikkat: 'hot_lead', reason: 'Deneme dersine geldi, paketi bekliyor.',
    mesajlar: [
      ['user', 'Dün deneme dersine gelmiştim, çok beğendim'],
      ['assistant', 'Çok sevindik! 🌸 16 derslik paketimizle devam ederseniz ders başı maliyetiniz belirgin şekilde düşüyor. Sizin için ayırayım mı?'],
      ['user', 'Bir düşüneyim, eşimle konuşacağım'],
      ['assistant', 'Tabii ki, acele etmeyin 🙂 Karar verdiğinizde buradayız.'],
      ['user', 'Konuştuk, 16 derslik olsun. Ne zaman gelebilirim?'],
    ],
  })
  await sohbet({
    rakam: '905071883452', ad: 'Selin Baş', gunOnce: 4, temp: SICAK, status: 'ai',
    dikkat: 'ai_failed', reason: 'Doğum sonrası dönem — AI cevap vermeyip devretti.',
    mesajlar: [
      ['user', 'Merhaba, 3 ay önce doğum yaptım. Pilates yapabilir miyim?'],
      ['assistant', 'Merhaba 🌸 Doğum sonrası dönemde çalışmaya başlamak için doktorunuzun onayı gerekiyor; bu konuda size sağlıklı bir yanıt verebilmem için eğitmenimize aktarıyorum. Kısa süre içinde size dönecek.'],
      ['user', 'Doktorum onay verdi, raporu da var'],
    ],
  })

  // Ilık ve soğuklar — huninin gerçek şekli. Herkesin sıcak olduğu bir huni, huni değildir.
  const ILIKLAR: readonly (readonly [string, string, number, string, readonly (readonly ['user' | 'assistant', string])[]])[] = [
    ['905442017733', 'Gül Ertan', 6, 'Fiyat sordu, sessizleşti.', [
      ['user', 'Aylık ne kadar?'],
      ['assistant', 'Merhaba! Fitness üyeliğimiz aylık 1.500 TL, 3 aylık 3.900 TL 🙂 Reformer pilates paketlerimiz için de bilgi vereyim mi?'],
      ['user', 'Şimdilik teşekkürler'],
    ]],
    ['905356620941', 'Beyza K.', 9, 'Saat uyuşmazlığı — akşam 21:00 istiyor.', [
      ['user', 'Akşam 21:00 seansınız var mı?'],
      ['assistant', 'En geç seansımız 20:00\'de başlıyor ve 20:50\'de bitiyor. 20:00 sizin için uygun olur mu?'],
      ['user', 'İşten 20:30\'da çıkıyorum maalesef'],
      ['assistant', 'Anlıyorum 🙁 Cumartesi sabah seanslarımız da var, dilerseniz onları değerlendirebilirsiniz.'],
    ]],
    ['905309914502', 'Hazal Y.', 14, 'Adres sordu, gelmedi.', [
      ['user', 'Stüdyonuz nerede?'],
      ['assistant', 'Merkez şubemizdeyiz 📍 Konum linkini paylaşıyorum. Otopark sorunu yaşamazsınız, hemen önümüzde yer var.'],
      ['user', 'Teşekkürler'],
    ]],
    ['905546338820', 'Merve S.', 19, 'Hamilelik pilatesi soruyor.', [
      ['user', 'Hamileler için grubunuz var mı?'],
      ['assistant', 'Şu anda ayrı bir hamile grubumuz yok, ancak eğitmenimiz mevcut seanslarda size uygun hareketlerle çalışabiliyor 🌸 Doktor onayınız varsa detayını konuşalım.'],
      ['user', 'Doktora soracağım'],
    ]],
  ]
  for (const [tel, ad, g, neden, msgs] of ILIKLAR) {
    await sohbet({ rakam: tel, ad, gunOnce: g, temp: ILIK, status: 'ai', reason: neden, mesajlar: msgs })
  }

  const SOGUKLAR: readonly (readonly [string, string, number, string, string])[] = [
    ['905398871260', 'Deniz A.', 21, 'Erkek üye — stüdyo kadınlara özel.', 'Erkekler için de var mı?'],
    ['905427790614', 'Ceyda M.', 24, 'Başka ilçede oturuyor.', 'Kadıköy şubeniz var mı?'],
    ['905059912847', 'Tuğba E.', 28, 'Sadece fiyat sordu, dönmedi.', 'Fiyat listesi'],
  ]
  for (const [tel, ad, g, neden, soru] of SOGUKLAR) {
    await sohbet({
      rakam: tel, ad, gunOnce: g, temp: SOGUK, status: 'ai', reason: neden,
      mesajlar: [
        ['user', soru],
        ['assistant', 'Merhaba! 🌸 Stüdyomuz kadınlara özel hizmet veriyor ve şu an tek şubemiz merkezde. Size yardımcı olabileceğim başka bir konu var mı?'],
      ],
    })
  }
  const sohbetSayi = 2 + 3 + ILIKLAR.length + SOGUKLAR.length
  console.log(`✓ ${sohbetSayi} WhatsApp sohbeti (${2} dönüşmüş · 3 dikkat bekleyen · ${ILIKLAR.length} ılık · ${SOGUKLAR.length} soğuk)`)

  // ── 5b · Satış hunisi (leads) ──────────────────────────────────────────────────────────────
  // Lead bir üye DEĞİL: dönüşüm açık bir eylem, üyeyi üretir ve leadi kapatır. Bu yüzden `won`
  // aşamasına elle yazmıyoruz — `decideMoveStage`/`decideLoseLead` üzerinden geçiyoruz ki
  // `closedAt`, `lostReason` gibi alanlar kendiliğinden tutarlı olsun.
  const dc = () => ({
    studioId: STUDIO,
    actor: ctx.actor,
    now: instant(Date.now()),
    correlationId: newCorrelationId(),
    source: 'reception' as const,
  })

  const lead = async (v: {
    ad: string; tel: string; kaynak: Lead['source']; kaynakDetay: string | null
    gunOnce: number; hedef: LeadStage; kayipNeden?: Lead['lostReason']; not: string
  }) => {
    const id = `led_${Math.floor(rnd() * 1e12).toString(16).padStart(24, '0').slice(0, 24)}`
    const olustu = instant(now - v.gunOnce * DAY)
    const taze: Lead = {
      id, studioId: STUDIO, branchId: BRANCH,
      fullName: v.ad, phone: v.tel, email: null,
      source: v.kaynak, sourceDetail: v.kaynakDetay,
      stage: 'new', ownerStaffId: null,
      createdAt: olustu, createdBy: ctx.actor,
      lostReason: null, lostNote: null, convertedMemberId: null, closedAt: null,
      note: v.not,
    } as Lead
    const c = decideCaptureLead(dc(), taze)
    if (!c.ok) throw new Error(`lead ${v.ad}: ${JSON.stringify(c.error)}`)
    await crmRepo.saveLead(ctx, c.value.next, c.value.events)

    let simdiki = c.value.next
    if (v.hedef === 'lost') {
      const l = decideLoseLead(dc(), simdiki, v.kayipNeden ?? 'other', 'Demo kaydı')
      if (!l.ok) throw new Error(`lead kayıp ${v.ad}: ${JSON.stringify(l.error)}`)
      await crmRepo.saveLead(ctx, l.value.next, l.value.events)
      return l.value.next
    }
    // new → contacted → trial → offer, sırayla: aşama atlamak bir iş akışını değil, veri kurgusunu
    // anlatır ve olayların sırası da yalan olur.
    const SIRA: readonly LeadStage[] = ['contacted', 'trial', 'offer']
    for (const asama of SIRA) {
      if (SIRA.indexOf(asama) > SIRA.indexOf(v.hedef as LeadStage)) break
      const m = decideMoveStage(dc(), simdiki, asama)
      if (!m.ok) break
      await crmRepo.saveLead(ctx, m.value.next, m.value.events)
      simdiki = m.value.next
      if (asama === v.hedef) break
    }
    return simdiki
  }

  const LEADLER: readonly Parameters<typeof lead>[0][] = [
    { ad: 'Nihan Çetinkaya', tel: '+905321440118', kaynak: 'phone', kaynakDetay: 'WhatsApp AI', gunOnce: 1, hedef: 'offer', not: '6 kişilik kurumsal grup. Fiyat onayı bekliyor.' },
    { ad: 'Ayça Ünal', tel: '+905331229074', kaynak: 'instagram', kaynakDetay: 'WhatsApp AI', gunOnce: 5, hedef: 'offer', not: 'Deneme dersine geldi, 16 ders istiyor.' },
    { ad: 'Selin Baş', tel: '+905071883452', kaynak: 'instagram', kaynakDetay: 'WhatsApp AI', gunOnce: 4, hedef: 'trial', not: 'Doğum sonrası, doktor onayı var.' },
    { ad: 'Gül Ertan', tel: '+905442017733', kaynak: 'google', kaynakDetay: 'WhatsApp AI', gunOnce: 6, hedef: 'contacted', not: 'Fiyat sordu.' },
    { ad: 'Beyza Kılıçarslan', tel: '+905356620941', kaynak: 'walk_in', kaynakDetay: null, gunOnce: 9, hedef: 'contacted', not: 'Akşam 21:00 istiyor.' },
    { ad: 'Hazal Yücel', tel: '+905309914502', kaynak: 'google', kaynakDetay: 'WhatsApp AI', gunOnce: 14, hedef: 'new', not: 'Adres sordu.' },
    { ad: 'Merve Sağlam', tel: '+905546338820', kaynak: 'referral', kaynakDetay: 'Üye tavsiyesi', gunOnce: 19, hedef: 'trial', not: 'Hamilelik pilatesi.' },
    { ad: 'Esin Toprak', tel: '+905324471190', kaynak: 'event', kaynakDetay: 'Mahalle etkinliği', gunOnce: 22, hedef: 'new', not: 'Standtan broşür aldı.' },
    { ad: 'Ceyda Meriç', tel: '+905427790614', kaynak: 'instagram', kaynakDetay: 'WhatsApp AI', gunOnce: 24, hedef: 'lost', kayipNeden: 'location', not: 'Başka ilçe.' },
    { ad: 'Tuğba Erdem', tel: '+905059912847', kaynak: 'google', kaynakDetay: 'WhatsApp AI', gunOnce: 28, hedef: 'lost', kayipNeden: 'price', not: 'Bütçe uymadı.' },
    { ad: 'Pelin Aksan', tel: '+905337712064', kaynak: 'referral', kaynakDetay: 'Üye tavsiyesi', gunOnce: 31, hedef: 'lost', kayipNeden: 'schedule', not: 'Vardiyalı çalışıyor.' },
  ]
  const yazilan: Lead[] = []
  for (const l of LEADLER) yazilan.push(await lead(l))
  console.log(`✓ ${yazilan.length} lead (huni: yeni · görüşüldü · deneme · teklif · kayıp)`)

  // Görüşme kayıtları — huninin "ne yapıldı" tarafı. Boş bir lead kartı kimseyi ikna etmez.
  let gorusme = 0
  for (const l of yazilan.slice(0, 7)) {
    const kac = arasi(1, 3)
    for (let k = 0; k < kac; k++) {
      const i: Interaction = {
        id: `int_${Math.floor(rnd() * 1e12).toString(16).padStart(20, '0').slice(0, 20)}`,
        studioId: STUDIO,
        kind: sec(['call', 'whatsapp', 'trial', 'note'] as const),
        leadId: l.id,
        memberId: null,
        text: sec([
          'Aradım, bilgi verdim. Fiyat listesini WhatsApp\'tan gönderdim.',
          'Deneme dersi için çarşamba sabahına yer ayırdım.',
          'Ulaşamadım, akşam tekrar denenecek.',
          'Kampanya bitiş tarihini hatırlattım.',
        ]),
        at: instant(now - arasi(1, 20) * DAY),
        by: ctx.actor,
        outcome: sec(['reached', 'no_answer', 'callback'] as const),
      } as Interaction
      const d = decideLogInteraction(dc(), i)
      if (!d.ok) continue
      await crmRepo.saveInteraction(ctx, d.value.next, d.value.events)
      gorusme++
    }
  }
  console.log(`✓ ${gorusme} görüşme kaydı`)

  // ── 6 · AI ─────────────────────────────────────────────────────────────────────────────────
  // Bilgi kartı: WhatsApp resepsiyonistinin bildiği her şey. `whatsappActive: true` — owner'ın
  // istediği "Meta kurulumu varmış gibi" hâli bu bayrak veriyor. Kimlik bilgileri Firestore'da
  // DEĞİL (ortam değişkeni), yani bu bayrak demoda hiçbir yere gerçek mesaj göndermez.
  await db.doc(`studios/${STUDIO}/settings/ai`).set({
    tone: 'Sıcak, samimi ve kısa. Emoji kullan ama abartma. Asla satış baskısı yapma — üyenin kendi kararıyla gelmesi bizim için daha değerli.',
    identity: 'Demo Stüdyo\'nun WhatsApp resepsiyonistisin. Kadınlara özel bir Pilates & Fitness stüdyosuyuz. Adın Ada. Bir insan olduğunu iddia etme; sorulursa stüdyonun dijital asistanı olduğunu söyle.',
    basics: [
      'Çalışma saatleri: Hafta içi 07:00-22:00, Cumartesi 09:00-17:00. Pazar kapalı.',
      'Tek şube: Merkez.',
      'Salonlar: Reformer Salonu (8 kişi), Mat Salonu (12 kişi), Fitness Alanı (20 kişi).',
      'Dersler: Reformer Pilates (50 dk), Mat Pilates (45 dk), Fitness serbest kullanım, Kişisel Antrenman.',
      'Stüdyo kadınlara özeldir; erkek üye kabul edilmez.',
      'İlk gelişte rahat bir tayt ve çorap yeterli. Ekipman stüdyoda mevcut.',
    ].join('\n'),
    policies: [
      'Rezervasyon iptali ders saatinden 6 saat öncesine kadar ücretsizdir; sonrasında ders hakkı düşer.',
      'Günde en fazla 1 rezervasyon yapılabilir.',
      'Paket dondurma hakkı 14 gündür.',
      'Ders hakkı paketin geçerlilik süresi içinde kullanılmalıdır; süre dolduğunda kalan hak yanar.',
      'Fiyatta indirim yetkisi yalnızca stüdyo sahibindedir — indirim sorulduğunda söz verme, aktarım yap.',
    ].join('\n'),
    campaign: 'Reformer Pilates 8 Ders 4.800 TL · 16 Ders 8.800 TL (16 derste ders başı maliyet belirgin şekilde düşüyor). Fitness aylık 1.500 TL · 3 aylık 3.900 TL · yıllık 12.900 TL.',
    faq: [
      { q: 'Hiç pilates yapmadım, başlayabilir miyim?', a: 'Kesinlikle. Üyelerimizin çoğu sıfırdan başladı. İlk derste eğitmenimiz sizinle birebir ilgilenir ve tempoyu size göre ayarlar.' },
      { q: 'Deneme dersi var mı?', a: 'Evet, bir deneme dersi ayarlayabiliyoruz. Hangi gün ve saat size uygun olur?' },
      { q: 'Erkekler gelebiliyor mu?', a: 'Stüdyomuz kadınlara özeldir, erkek üye kabul etmiyoruz.' },
      { q: 'Hamileyken pilates yapabilir miyim?', a: 'Doktorunuzun onayı varsa eğitmenimiz size uygun hareketlerle çalışabiliyor. Onayınızı getirmeniz yeterli.' },
      { q: 'Doğum sonrası ne zaman başlayabilirim?', a: 'Bu tamamen doktorunuzun değerlendirmesine bağlı. Onay aldıysanız eğitmenimizle konuşup size özel bir başlangıç planı yapıyoruz.' },
      { q: 'Adet dönemimde derse gelebilir miyim?', a: 'Elbette. Kendinizi nasıl hissettiğinize göre eğitmenimiz hareketleri hafifletebilir.' },
      { q: 'Dersi kaçırırsam hakkım yanar mı?', a: 'Ders saatinden 6 saat öncesine kadar iptal ederseniz hakkınız korunur. Daha geç iptallerde ne yazık ki hak düşüyor.' },
      { q: 'Paketimi dondurabilir miyim?', a: '14 güne kadar dondurma hakkınız var. Resepsiyondan talep etmeniz yeterli.' },
      { q: 'Otopark var mı?', a: 'Stüdyonun hemen önünde park edebilirsiniz, sorun yaşamazsınız.' },
      { q: 'Duş ve dolap var mı?', a: 'Evet, duş ve kilitli dolaplarımız mevcut. Havlu getirmenizi öneririz.' },
      { q: 'Kredi kartına taksit yapıyor musunuz?', a: 'Evet, kredi kartına taksit imkânımız var. Detayını resepsiyondaki arkadaşımız paylaşır.' },
      { q: 'Üyeliğimi arkadaşıma devredebilir miyim?', a: 'Paketler kişiye özeldir ve devredilemez. Ancak arkadaşınız için tavsiye indirimi sunabiliyoruz.' },
    ],
    escalation: 'Şu durumlarda cevap verme, stüdyoya aktar: indirim veya özel fiyat talebi, sağlık durumu (sakatlık, ameliyat, gebelik, doğum sonrası), şikâyet, iade talebi, kurumsal/toplu üyelik. Aktarırken üyeye "en kısa sürede dönüş yapılacak" de ve söz verdiğin şeyi abartma.',
    neverDo: 'Fiyat pazarlığı yapma. İndirim vaat etme. Sağlık tavsiyesi verme veya "yapabilirsin" deme. Kesin randevu saati onaylama — yer ayırdığını söyle, teyit resepsiyondan gelir. Üyenin kişisel bilgilerini başka birine söyleme. Bilmediğin bir şeyi uydurma; bilmiyorsan aktar.',
    examples: [
      'Üye: "Aylık ne kadar?" → "Merhaba! 🌸 Fitness üyeliğimiz aylık 1.500 TL, 3 aylık 3.900 TL. Reformer pilates paketlerimiz için de bilgi vereyim mi?"',
      'Üye: "İndirim yapar mısınız?" → "Bu konuda karar stüdyo sahibimizde 🙂 Talebinizi hemen aktarıyorum, size dönüş yapacak."',
      'Üye: "Dizimde sorun var, gelebilir miyim?" → "Sağlık durumunuzla ilgili doğru yönlendirmeyi eğitmenimiz yapmalı. Sizi ona aktarıyorum, kısa süre içinde dönecek 🌸"',
    ].join('\n'),
    whatsappActive: true,
  })
  console.log('✓ AI bilgi kartı (12 SSS · aktarım kuralları · WhatsApp aktif)')

  // Patron brifingi — haftanın anahtarı tutarsa Anthropic çağrısı hiç yapılmıyor, bu metin görünür.
  const hafta = haftaAnahtari(now)
  await db.doc(`studios/${STUDIO}/settings/patronBriefing`).set({
    weekKey: hafta,
    answer: [
      'Bu hafta stüdyo iyi durumda ama iki yerde para masada duruyor.',
      '',
      'Doluluk geçen haftaya göre yükseldi; akşam 19:00 ve 20:00 reformer seansları neredeyse dolu, sabah 09:00 seansında ise düzenli olarak boş yer kalıyor. Sabah seansını tamamen kapatmak yerine, akşam yeri bulamayan üyelere sabahı önermek daha mantıklı — talep var, saat uyuşmuyor.',
      '',
      'Açık bakiye biriken üye sayısı arttı. Bunların çoğu unutkanlık, tahsilat sorunu değil; bir hatırlatma mesajı genelde yetiyor. Şu an tahsil edilmemiş tutar, bir haftalık reformer cirosuna denk.',
      '',
      'Paketi bitmek üzere olan üyeler yenileme için en verimli grup — henüz kopmadılar ve size hâlâ gelmeye devam ediyorlar. Paketleri bittikten sonra aramak, bitmeden önce aramaktan belirgin şekilde düşük dönüş veriyor.',
      '',
      'WhatsApp tarafında üç kişi cevap bekliyor; biri kurumsal grup talebi ve fiyat yetkisi sizde olduğu için sistem size aktardı. Bu hafta en yüksek getirili tek iş muhtemelen o.',
    ].join('\n'),
    actions: ['remind_debtors', 'renew_expiring', 'draft_campaign'],
    generatedAt: now - arasi(2, 20) * 3_600_000,
  })
  console.log(`✓ Patron brifingi (hafta ${hafta})`)

  // ── 7 · Antrenman ──────────────────────────────────────────────────────────────────────────
  // Egzersiz kütüphanesi olmadan AI program üreticisinin yedek (fallback) yolu bile çalışmıyor —
  // havuzu oradan kuruyor. Yani bu kütüphane, anahtarsız bir demoda "AI ile Öner" düğmesinin
  // çalışmasının ön koşulu.
  const EGZERSIZ: readonly (readonly [string, string, string, string])[] = [
    ['Squat', 'Squat', 'Bacak', 'Vücut ağırlığı'],
    ['Goblet Squat', 'Goblet Squat', 'Bacak', 'Dumbbell'],
    ['Kalça Köprüsü', 'Glute Bridge', 'Kalça', 'Mat'],
    ['Hip Thrust', 'Hip Thrust', 'Kalça', 'Bar'],
    ['Plank', 'Plank', 'Karın', 'Mat'],
    ['Yan Plank', 'Side Plank', 'Karın', 'Mat'],
    ['Ölü Böcek', 'Dead Bug', 'Karın', 'Mat'],
    ['Kuş Köpek', 'Bird Dog', 'Sırt', 'Mat'],
    ['Lat Pulldown', 'Lat Pulldown', 'Sırt', 'Makine'],
    ['Oturarak Kürek', 'Seated Row', 'Sırt', 'Makine'],
    ['Dumbbell Göğüs Pres', 'Dumbbell Chest Press', 'Göğüs', 'Dumbbell'],
    ['Omuz Pres', 'Shoulder Press', 'Omuz', 'Dumbbell'],
    ['Lunge', 'Walking Lunge', 'Bacak', 'Vücut ağırlığı'],
    ['Romanian Deadlift', 'Romanian Deadlift', 'Arka Bacak', 'Bar'],
    ['Reformer Footwork', 'Reformer Footwork', 'Bacak', 'Reformer'],
    ['Reformer Hundred', 'Reformer Hundred', 'Karın', 'Reformer'],
  ]
  const egzId: string[] = []
  for (const [tr, en, kas, ekip] of EGZERSIZ) {
    const e = ok(await upsertExercise(trainDeps, ctx, {
      nameTr: tr, nameEn: en, muscleGroup: kas, equipment: ekip,
      description: `${tr} — ${kas.toLowerCase()} bölgesi için temel hareket.`,
      tips: 'Hareketi kontrollü yap, nefesini tutma.',
      commonMistakes: 'Beli aşırı çukurlaştırmak, hareketi hızlandırmak.',
      active: true,
    }, 'reception'), `egzersiz ${tr}`)
    egzId.push(e.id)
  }
  console.log(`✓ ${egzId.length} egzersiz (kütüphane — AI önerisinin havuzu)`)

  const gunYap = (sira: number, ad: string, idx: readonly number[]): DraftProgramDay => ({
    order: sira,
    name: ad,
    exercises: idx.map((n, i) => ({
      exerciseId: egzId[n]!,
      order: i + 1,
      sets: arasi(3, 4),
      reps: sec(['10', '12', '8-10', '12-15']),
      restSeconds: sec([45, 60, 90]),
      tempo: sec(['2-0-2', '3-1-1', '']),
      note: i === 0 ? 'Isınma seti ile başla.' : '',
      alternativeExerciseId: null,
    })),
  })

  const PROGRAMLAR: readonly (readonly [number, string, string, readonly DraftProgramDay[]])[] = [
    [1, 'Başlangıç Kuvvet — 3 Gün', 'AI önerisi', [
      gunYap(1, 'Gün 1 — Alt Vücut', [0, 2, 12, 4]),
      gunYap(2, 'Gün 2 — Üst Vücut', [8, 10, 11, 7]),
      gunYap(3, 'Gün 3 — Tüm Vücut', [1, 3, 9, 6]),
    ]],
    [5, 'Kalça & Core Odaklı', 'Eğitmen programı', [
      gunYap(1, 'Gün 1 — Kalça', [3, 2, 13, 12]),
      gunYap(2, 'Gün 2 — Core', [4, 5, 6, 7]),
    ]],
    [9, 'Reformer Destekli Toparlanma', 'AI önerisi', [
      gunYap(1, 'Gün 1 — Reformer', [14, 15, 4, 7]),
      gunYap(2, 'Gün 2 — Mat', [2, 6, 5, 12]),
    ]],
    [17, 'İleri Seviye Kuvvet — 4 Gün', 'Eğitmen programı', [
      gunYap(1, 'Gün 1 — İtiş', [10, 11, 4]),
      gunYap(2, 'Gün 2 — Çekiş', [8, 9, 7]),
      gunYap(3, 'Gün 3 — Bacak', [1, 13, 12]),
      gunYap(4, 'Gün 4 — Core', [4, 5, 6]),
    ]],
  ]
  let prog = 0
  for (const [uyeIdx, baslik, not, gunler] of PROGRAMLAR) {
    const u = uyeler[uyeIdx]
    if (!u) continue
    const p = ok(await createProgram(trainDeps, ctx, {
      memberId: u.id, trainerId: OWNER, title: baslik,
      startsOn: trTarih(now - 20 * DAY), endsOn: trTarih(now + 40 * DAY),
    }, 'reception'), `program ${baslik}`)
    ok(await publishProgramVersion(trainDeps, ctx, { programId: p.id, days: gunler, note: not }, 'reception'), `sürüm ${baslik}`)
    ok(await changeProgramStatus(trainDeps, ctx, p.id, 'active', 'reception'), `aktif ${baslik}`)
    prog++
  }
  console.log(`✓ ${prog} antrenman programı (2'si AI önerisi · hepsi yayımlanmış ve aktif)`)

  // Ölçümler — tek bir satır bir şey söylemez, TARİHÇE söyler. Üç ölçüm arasında yağın düşüp
  // kasın korunduğu bir üye, ürünün asıl anlattığı şey.
  let olcum = 0
  for (const uyeIdx of [1, 5, 9, 17, 23]) {
    const u = uyeler[uyeIdx]
    if (!u) continue
    let kilo = 62 + rnd() * 18
    let yag = 30 + rnd() * 8
    let kas = 22 + rnd() * 4
    for (const g of [90, 60, 30, 3]) {
      const boyM = 1.65
      ok(await recordMeasurement(trainDeps, ctx, {
        memberId: u.id,
        takenOn: trTarih(now - g * DAY),
        weightKg: Number(kilo.toFixed(1)),
        fatPercent: Number(yag.toFixed(1)),
        musclePercent: Number((kas / kilo * 100).toFixed(1)),
        waterPercent: Number((50 + rnd() * 5).toFixed(1)),
        muscleKg: Number(kas.toFixed(2)),
        fatKg: Number((kilo * yag / 100).toFixed(2)),
        waterKg: Number((kilo * 0.52).toFixed(2)),
        leanMassKg: Number((kilo * (1 - yag / 100)).toFixed(2)),
        leanMassPercent: Number((100 - yag).toFixed(1)),
        idealWeightKg: 60,
        bmi: Number((kilo / (boyM * boyM)).toFixed(1)),
        bmr: Math.round(1300 + kas * 20),
        visceralFat: arasi(3, 9),
        circumferences: {
          bel: Number((72 + yag * 0.8).toFixed(1)),
          kalca: Number((95 + rnd() * 8).toFixed(1)),
          gogus: Number((88 + rnd() * 6).toFixed(1)),
        },
        note: g === 90 ? 'İlk ölçüm.' : g === 3 ? 'Yağ oranı düzenli düşüyor, kas korunuyor.' : '',
      }, 'reception'), `ölçüm ${u.ad}`)
      olcum++
      // Gerçekçi ilerleme: yağ düşüyor, kas korunuyor/hafif artıyor, kilo yavaş iniyor.
      kilo -= 0.8 + rnd() * 1.2
      yag -= 0.9 + rnd() * 0.8
      kas += rnd() * 0.4
    }
  }
  console.log(`✓ ${olcum} ölçüm (5 üye · 90 günlük tarihçe)`)

  // ── 8 · Turnike ────────────────────────────────────────────────────────────────────────────
  // İki cihaz: giriş ve çıkış tarafı. `side` alanı kapının NE YAPTIĞINI söylüyor — o olmadan yön
  // "içeride mi değil mi" tahmininden çıkarılıyor ve bir üye telefonunu unutup içeride kalırsa
  // sayaç kayıyor.
  //
  // `secretHash` = sırrın hex SHA-256'sı. Demo cihazın token'ı burada AÇIKÇA yazılı, çünkü demo
  // cihazı yok: bu kayıtların işi kapı ekranını değil, panelin geçiş geçmişini beslemek.
  const { createHash } = await import('node:crypto')
  const cihaz = async (id: string, ad: string, taraf: 'in' | 'out', sir: string) => {
    await db.doc(`studios/${STUDIO}/devices/${id}`).set({
      studioId: STUDIO,
      branchId: BRANCH,
      name: ad,
      side: taraf,
      secretHash: createHash('sha256').update(sir).digest('hex'),
      active: true,
      lastSeenAt: Timestamp.fromMillis(now - arasi(1, 25) * 60_000),
      createdAt: Timestamp.fromMillis(now - 40 * DAY),
    })
  }
  await cihaz('dev_demo_giris', 'Giriş turnikesi', 'in', 'demo-giris-sirri')
  await cihaz('dev_demo_cikis', 'Çıkış turnikesi', 'out', 'demo-cikis-sirri')
  console.log('✓ 2 turnike cihazı (giriş / çıkış · son görülme birkaç dakika önce)')

  // Geçiş geçmişi. Doğrudan `checkIns` yazıyoruz, `recordCheckIn` üzerinden DEĞİL: uygulama yolu
  // 45 saniyelik tekrar koruması ve "zaten içeride" kontrolüyle BUGÜNÜN durumuna bakıyor, geçmişe
  // 200 geçiş yazmak için tasarlanmadı. Yazdığımız şey olayın kendisi değil, kaydı — ve `presence`
  // (şu an içeride kim var) iskeletteki gerçek check-in'lerden geliyor, buraya karışmıyor.
  const gecisUyeleri = uyeler.slice(0, 22)
  let gecis = 0
  // Bir batch commit'ten SONRA yeniden kullanılamaz — 400'de bir yenisini açıyoruz (Firestore
  // sınırı 500).
  let batch = db.batch()
  let bekleyen = 0
  const yaz = async (ref: FirebaseFirestore.DocumentReference, veri: Record<string, unknown>) => {
    batch.set(ref, veri)
    if (++bekleyen >= 400) {
      await batch.commit()
      batch = db.batch()
      bekleyen = 0
    }
  }

  for (const u of gecisUyeleri) {
    for (let g = 1; g <= 30; g++) {
      if (rnd() > 0.42) continue // herkes her gün gelmiyor
      const girisMs = now - g * DAY + (arasi(8, 20) * 60 + arasi(0, 59)) * 60_000
      if (girisMs > now) continue
      const cikisMs = girisMs + arasi(55, 110) * 60_000
      for (const [ms, yon, dev] of [
        [girisMs, 'in', 'dev_demo_giris'],
        [cikisMs, 'out', 'dev_demo_cikis'],
      ] as const) {
        await yaz(db.collection(`studios/${STUDIO}/checkIns`).doc(), {
          studioId: STUDIO,
          memberId: u.id,
          branchId: BRANCH,
          direction: yon,
          method: 'device',
          occurredAt: Timestamp.fromMillis(ms), // alan zamanı
          actor: { type: 'device', id: dev },
          recordedAt: FieldValue.serverTimestamp(), // kaydedildiği an — ikisi asla aynı alan değil
        })
        gecis++
      }
    }
  }
  if (bekleyen > 0) await batch.commit()
  console.log(`✓ ${gecis} turnike geçişi (22 üye · 30 gün · giriş+çıkış eşli)`)

  console.log('\n✅ Faz 5-8 tamam: WhatsApp hunisi, AI, antrenman, turnike')
  process.exit(0)
}

void main()
