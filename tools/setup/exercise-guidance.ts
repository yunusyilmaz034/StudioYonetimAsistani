// `pnpm setup:exercise-guidance` — fill the Fitness library's GUIDANCE text (kas grupları + hareket
// özeti → description, ipuçları → tips, sık hatalar → commonMistakes) through the product's own domain
// path (upsertExercise → decide → transact). This is the PF-11 content: the model already carried these
// fields and the edit form already accepted them; only their VALUES were blank and there was no read
// view. Görseller (başlangıç/yapılış + doğru/yanlış) telif kararı bekliyor — model onlara hazır
// (photoUrl/gifUrl), bu script metni doldurur.
//
// Idempotent by nameTr; passes the existing muscleGroup/equipment too, so nothing is lost on a re-run.
// Only exercises present in BOTH the library and this map are touched — a partial map is fine.
import {
  FirestoreTrainingRepository,
  systemClock,
  upsertExercise,
  type TenantContext,
  type StudioId,
  type TrainingDeps,
} from '@studio/core'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'

const PROJECT = process.env.GCLOUD_PROJECT ?? 'demo-sos'
if (!process.env.FIRESTORE_EMULATOR_HOST && !process.env.ALLOW_PRODUCTION) {
  console.error('Refusing to run against production without ALLOW_PRODUCTION=1.')
  process.exit(1)
}
const STUDIO = (process.argv[2] ?? 'retro') as StudioId

interface Guide {
  readonly description: string // 🎯 kas grupları + kısa hareket özeti
  readonly tips: string // ipuçları (her satır bir ipucu)
  readonly commonMistakes: string // sık yapılan hatalar (her satır bir hata)
}

const GUIDES: Readonly<Record<string, Guide>> = {
  'Leg Press': {
    description:
      '🎯 Ana: Quadriceps (ön bacak) · İkincil: Gluteus (kalça), Hamstring · Zayıf: Baldır\n\nSırt ve bel mindere yaslı; ayaklar platformda omuz genişliğinde. Dizleri kontrollü bükerek ağırlığı indir, sonra topuklardan iterek başlangıca dön.',
    tips: 'Dizler ayak uçlarıyla aynı yönde, içe kırılmasın.\nBeli ve kalçayı minderden ayırma.\nDizleri en üstte tam kilitleme, hafif bükülü bırak.\nTam hareket aralığında, kontrollü in-çık.',
    commonMistakes:
      'Beli minderden kaldırmak (bel riski).\nDizleri içe bırakmak.\nÇok ağırlıkla kısmi (yarım) hareket.\nAğırlığı hızlı/sıçratarak indirmek.',
  },
  'Leg Extension': {
    description:
      '🎯 Ana: Quadriceps (ön bacak) · İzole hareket\n\nMakinede otur, ayak bileği pedin altında. Bacakları öne doğru düz gelene kadar kaldır, kontrollü indir.',
    tips: 'Hareketin tepesinde 1 saniye sık.\nİnişi kontrollü yap, bırakma.\nSırtı destek minderine yasla.',
    commonMistakes: 'Ağırlığı sallanarak/momentumla kaldırmak.\nİnişte ağırlığı serbest bırakmak.\nKalçayı koltuktan kaldırmak.',
  },
  'Leg Curl (Yatarak)': {
    description:
      '🎯 Ana: Hamstring (arka uyluk) · İkincil: Gluteus (kalça) · Zayıf: Baldır\n\nMakinede yüzüstü uzan, ayak bilekleri pedin altında. Bacakları dizden bükerek arka uyluğu çalıştır, kontrollü başlangıca dön.',
    tips: 'Beli makineye yasla, kaldırma.\nHareketi kontrollü ve yavaş yap.\nTam aralıkta uygula.',
    commonMistakes:
      'Beli/kalçayı kaldırıp sallanarak momentum yapmak.\nAni ve hızlı hareket.\nKaldırabileceğinden fazla ağırlık seçmek.',
  },
  'Seated Leg Curl': {
    description:
      '🎯 Ana: Hamstring (arka uyluk) · İkincil: Baldır\n\nOturarak, ayak bilekleri pedin üstünde. Topukları geriye/aşağı bükerek arka uyluğu çalıştır.',
    tips: 'Sırtı destek minderine tam yasla.\nDizleri sabit tut, sadece alt bacak hareket etsin.\nEn altta 1 saniye sık.',
    commonMistakes: 'Kalçayı koltuktan kaldırmak.\nMomentumla hızlı çekmek.\nKısmi hareket.',
  },
  'Romanian Deadlift (RDL)': {
    description:
      '🎯 Ana: Hamstring (arka uyluk), Gluteus (kalça) · İkincil: Bel/sırt alt · Zayıf: Sırt üst\n\nDizler hafif bükülü sabit; kalçayı geriye iterek gövdeyi öne eğ, ağırlığı bacak boyunca indir. Kalçayı öne sıkarak doğrul.',
    tips: 'Sırtı düz tut (kamburlaşma yok).\nHareket kalçadan başlasın, belden değil.\nAğırlığı bacaklara yakın tut.\nDizleri sabit tut, çömelme.',
    commonMistakes:
      'Sırtı yuvarlamak (ciddi bel riski).\nDizleri fazla büküp squat’a çevirmek.\nAğırlığı vücuttan uzak tutmak.\nBoynu aşırı yukarı kaldırmak.',
  },
  'Hip Thrust': {
    description:
      '🎯 Ana: Gluteus (kalça) · İkincil: Hamstring (arka uyluk) · Zayıf: Quadriceps\n\nSırt üst kısmı banka dayalı, ayaklar yerde. Kalçayı yukarı iterek gövde-uyluk düz hale gelene kadar kaldır, en üstte sık.',
    tips: 'En üstte kalçayı 1-2 saniye sık.\nÇeneyi hafif içe al, bel aşırı çukurlaşmasın.\nİtişi topuklardan yap.',
    commonMistakes: 'Beli aşırı çukurlaştırmak.\nYarım kaldırıp kalçayı tam sıkmamak.\nAyakları çok ileri/geri koymak.',
  },
  'Glute Bridge (Kalça Köprüsü)': {
    description:
      '🎯 Ana: Gluteus (kalça) · İkincil: Hamstring · Zayıf: Core\n\nSırt üstü yat, dizler bükülü, ayaklar yerde. Kalçayı yukarı kaldırıp sık, kontrollü indir.',
    tips: 'Karnı hafif sıkarak beli koru.\nEn üstte kalçayı sık.\nTopuklardan it.',
    commonMistakes: 'Beli kullanarak kaldırmak.\nEn üstte sıkmadan hızlı inip çıkmak.',
  },
  'Goblet Squat': {
    description:
      '🎯 Ana: Quadriceps (ön bacak), Gluteus (kalça) · İkincil: Core · Zayıf: Hamstring\n\nDumbbell/kettlebell’i göğüs önünde tut. Kalçayı geriye iterek çömel, topuklardan iterek kalk.',
    tips: 'Göğsü dik tut, sırtı düz.\nDizler ayak uçları yönünde.\nTopuklar yerden kalkmasın.\nUyluklar en az yere paralel insin.',
    commonMistakes: 'Dizleri içe bırakmak.\nTopukları kaldırmak.\nSırtı yuvarlamak.\nYarım çömelmek.',
  },
  'Bulgarian Split Squat': {
    description:
      '🎯 Ana: Quadriceps, Gluteus · İkincil: Hamstring, Core (denge) · Zayıf: Baldır\n\nArka ayak bankta, ön ayak önde. Ön bacağı bükerek in, ön topuktan iterek kalk.',
    tips: 'Gövdeyi hafif öne eğ (kalça vurgusu için).\nÖn dizi ayak ucunu geçmesin.\nDengeyi ön topuktan al.',
    commonMistakes: 'Ağırlığı arka ayağa vermek.\nÖn dizi içe bırakmak.\nGövdeyi çok dik/çok eğik tutmak.',
  },
  'Abductor (Dış Kalça)': {
    description:
      '🎯 Ana: Gluteus Medius (dış kalça) · İzole hareket\n\nMakinede otur, bacakları dışa doğru kontrollü aç, yavaşça kapat.',
    tips: 'Gövdeyi sabit tut, sallanma.\nEn dışta 1 saniye sık.\nKapanışı kontrollü yap.',
    commonMistakes: 'Momentumla hızlı açıp kapamak.\nGövdeyi öne eğip momentum katmak.',
  },
  'Adductor (İç Bacak)': {
    description:
      '🎯 Ana: Adductor (iç bacak) · İzole hareket\n\nMakinede otur, açık bacakları kontrollü olarak birbirine yaklaştır, yavaş aç.',
    tips: 'Gövdeyi sabit ve dik tut.\nTam aralıkta çalış.\nKapanışta 1 saniye sık.',
    commonMistakes: 'Ağırlığı sıçratarak kapatmak.\nÇok ağırlıkla kısa hareket.',
  },
  'Calf Raise (Baldır)': {
    description:
      '🎯 Ana: Gastrocnemius/Soleus (baldır) · İzole hareket\n\nÖn ayak basamakta, topukları aşağı indirip parmak ucunda en yükseğe çık.',
    tips: 'En tepede 1 saniye sık.\nAltta topuğu tam indirerek gerdir.\nKontrollü in-çık, zıplama.',
    commonMistakes: 'Yarım hareket (tam gerdirmemek).\nZıplayarak momentum yapmak.',
  },
  'Lateral Raise': {
    description:
      '🎯 Ana: Omuz (yan deltoid) · İzole hareket\n\nDumbbell’ler yanlarda; kolları hafif bükülü tutarak omuz hizasına kadar yanlara kaldır, kontrollü indir.',
    tips: 'Dirsekler bileklerden hafif yukarıda.\nOmuz hizasını geçme.\nHareketi kontrollü yap, sallama.',
    commonMistakes: 'Momentumla savurmak.\nÇok ağırlıkla trapezi devreye sokmak (omuzları kulağa çekmek).\nKolları tam düz kilitlemek.',
  },
  'Shoulder Press': {
    description:
      '🎯 Ana: Omuz (ön/yan deltoid) · İkincil: Triceps · Zayıf: Trapez üst\n\nOturur pozisyonda ağırlığı omuz hizasından yukarı it, kontrollü indir.',
    tips: 'Beli aşırı çukurlaştırma; karnı sık.\nDirsekleri tam kilitleme.\nİnişte omuz hizasına kadar getir.',
    commonMistakes: 'Beli aşırı geriye atmak.\nYarım hareket.\nAğırlığı boyunun çok önünde/arkasında itmek.',
  },
  Crunch: {
    description:
      '🎯 Ana: Karın (rektus abdominis) · İzole hareket\n\nSırt üstü, dizler bükülü. Üst gövdeyi karnı sıkarak yukarı kıvır, kontrollü indir.',
    tips: 'Hareketi karından başlat, boyundan çekme.\nÇeneyi göğse yapıştırma; yumruk mesafesi bırak.\nEn üstte 1 saniye sık.',
    commonMistakes: 'Boyundan/elden çekmek.\nMomentumla sıçramak.\nBeli tam kaldırıp sit-up’a çevirmek.',
  },
  Plank: {
    description:
      '🎯 Ana: Core (karın, transversus) · İkincil: Omuz, Kalça · İzometrik (sabit) tutuş\n\nDirsekler omuz altında, vücut baştan topuğa düz bir çizgi. Karnı ve kalçayı sıkarak pozisyonu koru.',
    tips: 'Kalçayı ne yukarı kaldır ne aşağı düşür.\nKarnı ve kalçayı sık.\nBoynu nötr tut, yere bak.\nSüreyi kaliteyle artır.',
    commonMistakes: 'Kalçayı yukarı kaldırmak.\nBeli çukurlaştırıp kalçayı düşürmek.\nNefesi tutmak.',
  },
  'Leg Raise (Bacak Kaldırma)': {
    description:
      '🎯 Ana: Karın alt (rektus alt) · İkincil: Kalça fleksörleri\n\nSırt üstü, bacakları düz/hafif bükülü yukarı kaldır, beli yere yapışık tutarak kontrollü indir.',
    tips: 'Beli yere yapışık tut.\nİnişi kontrollü yap, yere değdirme.\nHareketi karından yönet.',
    commonMistakes: 'Beli yerden kaldırıp çukurlaştırmak (bel riski).\nBacakları hızlı bırakmak.',
  },
  Hyperextension: {
    description:
      '🎯 Ana: Bel/sırt alt (erektör spina) · İkincil: Gluteus, Hamstring\n\nKalça pede dayalı; gövdeyi öne eğip sırtı düz tutarak gövde-bacak hizasına kadar doğrul.',
    tips: 'Sırtı düz tut, aşırı geriye atma.\nHareketi kontrollü yap.\nEn üstte vücudu düz çizgide durdur, aşırı uzatma.',
    commonMistakes: 'En üstte aşırı geriye kavis yapmak.\nMomentumla sıçramak.\nBoynu aşırı yukarı kaldırmak.',
  },
}

async function main(): Promise<void> {
  initializeApp({ projectId: PROJECT })
  const db: Firestore = getFirestore()
  const ctx: TenantContext = {
    studioId: STUDIO,
    branchIds: [] as never,
    role: 'owner',
    actor: { type: 'platform_admin', id: 'setup' as never },
  }
  const deps: TrainingDeps = { repo: new FirestoreTrainingRepository(db), clock: systemClock }

  const existing = await deps.repo.listExercises(ctx)
  const byName = new Map(existing.map((e) => [e.nameTr, e]))

  let updated = 0
  let missing = 0
  for (const [nameTr, g] of Object.entries(GUIDES)) {
    const ex = byName.get(nameTr)
    if (!ex) {
      missing++
      console.log(`  ? "${nameTr}" kütüphanede yok — atlandı`)
      continue
    }
    const r = await upsertExercise(
      deps,
      ctx,
      { id: ex.id, nameTr: ex.nameTr, muscleGroup: ex.muscleGroup, equipment: ex.equipment, active: ex.active, description: g.description, tips: g.tips, commonMistakes: g.commonMistakes },
      'reception_web',
    )
    if (!r.ok) throw new Error(`${nameTr} yazılamadı: ${r.error.code}`)
    updated++
    console.log(`  ~ ${nameTr}`)
  }
  console.log(`\n✅ Rehber içeriği: ${updated} egzersiz güncellendi${missing ? `, ${missing} eşleşmedi` : ''}.`)
  process.exit(0)
}

void main()
