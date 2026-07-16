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
  'Incline Chest Press': {
    description:
      '🎯 Ana: Üst göğüs · İkincil: Ön omuz, Triceps\n\nEğik sehpada, ağırlığı üst göğüs hizasından yukarı it, kontrollü indir.',
    tips: 'Kürek kemiklerini geride/sabit tut, göğsü yukarı ver.\nDirsekleri gövdeyle ~45° tut.\nİnişte üst göğse dokundur, zıplatma.',
    commonMistakes: 'Beli aşırı köprü yapmak.\nDirsekleri tam yana açmak (omuz riski).\nYarım hareket.',
  },
  'Chest Press (Düz)': {
    description:
      '🎯 Ana: Göğüs · İkincil: Ön omuz, Triceps\n\nDüz sehpada ağırlığı göğüs hizasından yukarı it, kontrollü indir.',
    tips: 'Kürekleri sıkıp sabitle.\nDirsekler ~45°, bilekler dik.\nTam aralıkta, kontrollü.',
    commonMistakes: 'Ağırlığı sıçratmak.\nDirsekleri kilitleyip momentum yapmak.\nKalçayı sehpadan kaldırmak.',
  },
  'Pec Fly (Peck Deck)': {
    description: '🎯 Ana: Göğüs (iç kısım) · İzole hareket\n\nMakinede kolları önde kavis çizerek birleştir, kontrollü aç.',
    tips: 'Dirsek açısını sabit tut (kavis, itiş değil).\nOrtada 1 saniye sık.\nAçarken kontrol et, bırakma.',
    commonMistakes: 'Ağırlığı sıçratarak kapatmak.\nDirsekleri fazla bükerek presse çevirmek.',
  },
  'Front Raise': {
    description: '🎯 Ana: Ön omuz (ön deltoid) · İzole hareket\n\nDumbbell/plakayı omuz hizasına kadar öne kaldır, kontrollü indir.',
    tips: 'Gövdeyi sabit tut, sallama.\nOmuz hizasını geçme.\nKontrollü in-çık.',
    commonMistakes: 'Momentumla savurmak.\nÇok ağırlıkla trapezi devreye sokmak.',
  },
  'Face Pull': {
    description:
      '🎯 Ana: Arka omuz, Trapez · İkincil: Rotator cuff (omuz sağlığı)\n\nHalatı yüz hizasına, dirsekleri dışa/yukarı açarak çek; ellerini kulak yanına getir.',
    tips: 'Dirsekleri yüksek tut.\nEn arkada kürekleri sık.\nHafif ağırlık, kaliteli tekrar.',
    commonMistakes: 'Çok ağırlıkla sırtı/momentumu kullanmak.\nDirsekleri düşürmek.',
  },
  'Triceps Pushdown (V-Bar)': {
    description: '🎯 Ana: Triceps · İzole hareket\n\nV-bar ile dirsekler gövdeye sabit; kolları aşağı düz iterek triceps’i sık.',
    tips: 'Dirsekler gövdede sabit, öne-arkaya gitmesin.\nEn altta 1 saniye sık.\nYukarı kontrollü dön.',
    commonMistakes: 'Dirsekleri sallamak.\nGövdeyi öne eğip vücut ağırlığıyla itmek.',
  },
  'Triceps Pushdown (Halat)': {
    description: '🎯 Ana: Triceps (dış baş vurgulu) · İzole hareket\n\nHalatla aşağı it ve en altta halatı hafif dışa aç; triceps’i sık.',
    tips: 'Dirsekleri sabit tut.\nEn altta halatı ayırıp sık.\nKontrollü dön.',
    commonMistakes: 'Omuzdan/gövdeden itmek.\nDirsekleri kaydırmak.',
  },
  'Dumbbell Biceps Curl': {
    description: '🎯 Ana: Biceps · İzole hareket\n\nDirsekler gövdede sabit; dumbbell’i büküp yukarı kaldır, kontrollü indir.',
    tips: 'Dirsekleri sabit tut.\nEn üstte sık, inişi kontrol et.\nBileği nötr/dik tut.',
    commonMistakes: 'Gövdeyi sallayıp momentum yapmak.\nDirseği öne kaydırmak.\nYarım hareket.',
  },
  'Hammer Curl': {
    description: '🎯 Ana: Biceps + Brachialis · İkincil: Önkol\n\nAvuç içi karşılıklı (nötr) tutuşla dumbbell’i büküp kaldır.',
    tips: 'Nötr tutuşu koru.\nDirsekleri sabit tut.\nKontrollü in-çık.',
    commonMistakes: 'Sallanmak.\nBileği kırmak.',
  },
  'Lat Pulldown': {
    description:
      '🎯 Ana: Sırt (latissimus) · İkincil: Biceps, Arka omuz\n\nBarı göğüs üstüne, dirsekleri aşağı-geri çekerek indir; kürekleri sık.',
    tips: 'Göğsü yukarı ver, hafif geriye yaslan.\nBarı boynun önüne çek.\nDirseklerden başlat, koldan değil.',
    commonMistakes: 'Barı ense arkasına çekmek.\nMomentumla sallanmak.\nOmuzları kulağa kaldırmak.',
  },
  'Seated Cable Row': {
    description:
      '🎯 Ana: Sırt (orta), Latissimus · İkincil: Biceps, Arka omuz\n\nTutamağı göbeğe doğru çek, kürekleri sık; kontrollü uzat.',
    tips: 'Sırtı düz tut, öne çökme.\nDirsekleri gövdeye yakın çek.\nEn arkada kürekleri sık.',
    commonMistakes: 'Beli yuvarlamak.\nGövdeyi öne-arkaya sallayıp momentum yapmak.\nOmuz silkme.',
  },
  'Single Arm Row': {
    description:
      '🎯 Ana: Sırt (latissimus, tek taraf) · İkincil: Biceps, Arka omuz\n\nBir el/diz bankta, diğer elle dumbbell’i kalçaya doğru çek.',
    tips: 'Sırtı düz tut.\nDirseği gövdeye yakın, kalçaya doğru çek.\nEn üstte küreği sık.',
    commonMistakes: 'Gövdeyi döndürüp momentum yapmak.\nOmuzdan silkmek.',
  },
  'Cable Glute Kickback': {
    description: '🎯 Ana: Gluteus (kalça) · İzole hareket\n\nAyak bileği kablo bağlı; bacağı dizden çok bükmeden geriye doğru sık.',
    tips: 'Gövdeyi sabit tut, beli çukurlaştırma.\nEn arkada kalçayı sık.\nKontrollü geri dön.',
    commonMistakes: 'Beli kullanarak tekmelemek.\nMomentumla savurmak.',
  },
  'Reverse Hack Squat': {
    description:
      '🎯 Ana: Quadriceps, Gluteus · İkincil: Hamstring\n\nMakinede yüz platforma dönük; kalçayı geriye iterek çömel, topuktan it.',
    tips: 'Göğsü dik tut.\nDizler ayak yönünde.\nTam aralıkta, kontrollü.',
    commonMistakes: 'Dizleri içe bırakmak.\nTopukları kaldırmak.\nYarım hareket.',
  },
  'Frog Pump': {
    description: '🎯 Ana: Gluteus (kalça) · İzole hareket\n\nSırt üstü, tabanlar birbirine bakacak (kurbağa) şekilde; kalçayı yukarı sıkarak kaldır.',
    tips: 'Tabanları birleştir, dizleri dışa aç.\nEn üstte kalçayı güçlü sık.\nBeli değil kalçayı kullan.',
    commonMistakes: 'Beli çukurlaştırmak.\nEn üstte sıkmamak.',
  },
  'Cable Pull Through': {
    description:
      '🎯 Ana: Gluteus, Hamstring · İkincil: Bel\n\nKabloya sırtı dönük; kalçayı geriye iterek öne eğil, kalçayı öne sıkarak doğrul.',
    tips: 'Hareket kalçadan (hip hinge), belden değil.\nSırtı düz tut.\nEn üstte kalçayı sık.',
    commonMistakes: 'Sırtı yuvarlamak.\nSquat’a çevirmek (dizden çömelmek).',
  },
  'Cable Abduction (Ayakta)': {
    description: '🎯 Ana: Gluteus medius (dış kalça) · İzole hareket\n\nAyak bileği kablo bağlı; bacağı yana açarak dış kalçayı çalıştır.',
    tips: 'Gövdeyi dik ve sabit tut.\nEn dışta 1 saniye sık.\nKontrollü geri getir.',
    commonMistakes: 'Gövdeyi yana eğip momentum yapmak.\nÇok ağırlıkla kısa hareket.',
  },
  'Hack Squat': {
    description:
      '🎯 Ana: Quadriceps · İkincil: Gluteus\n\nMakinede sırt yastığa dayalı; kalçayı indirerek çömel, topuklardan it.',
    tips: 'Sırtı yastığa yasla.\nDizler ayak yönünde.\nUyluk en az paralel insin.',
    commonMistakes: 'Topukları kaldırmak.\nDizleri içe bırakmak.\nYarım hareket.',
  },
  'Smith Machine Squat': {
    description:
      '🎯 Ana: Quadriceps, Gluteus · İkincil: Hamstring\n\nSabit barla kontrollü çömel; topuklardan iterek kalk.',
    tips: 'Ayak konumunu barın altına doğru ayarla.\nGöğsü dik tut.\nParalel/altına in.',
    commonMistakes: 'Dizleri içe bırakmak.\nYarım çömelmek.\nTopukları kaldırmak.',
  },
  'Sumo Squat': {
    description:
      '🎯 Ana: Quadriceps, İç bacak (adductor), Gluteus\n\nGeniş duruş, ayak uçları dışa; dik gövdeyle çömel, topuklardan kalk.',
    tips: 'Ayak uçları dışa, dizler aynı yönde.\nGöğsü dik tut.\nTopuklara bas.',
    commonMistakes: 'Dizleri içe bırakmak.\nGövdeyi öne eğmek.\nYarım hareket.',
  },
  'Yürüyen Lunge': {
    description:
      '🎯 Ana: Quadriceps, Gluteus · İkincil: Hamstring, Core (denge)\n\nÖne adım atarak alçal, ön topuktan iterek kalk ve öbür ayakla devam et.',
    tips: 'Gövdeyi dik tut.\nÖn diz ayak ucunu geçmesin.\nAdımı yeterince uzun at.',
    commonMistakes: 'Kısa adım (diz öne kayar).\nGövdeyi öne düşürmek.\nDengeyi kaybedip acele etmek.',
  },
  'Step Up': {
    description:
      '🎯 Ana: Quadriceps, Gluteus · İkincil: Denge/Core\n\nBir ayağı basamağa koy, o bacakla iterek yukarı çık, kontrollü in.',
    tips: 'İtişi üstteki topuktan al.\nGövdeyi dik tut.\nİnişi kontrol et, zıplamadan.',
    commonMistakes: 'Alttaki ayakla zıplamak.\nDizi içe bırakmak.',
  },
  Deadlift: {
    description:
      '🎯 Ana: Sırt alt, Gluteus, Hamstring · İkincil: Trapez, Önkol, Core\n\nBar bacaklara yakın; sırtı düz tutup kalça+dizden kalkarak barı yukarı taşı.',
    tips: 'Sırtı düz tut (kamburlaşma yok).\nBarı vücuda yakın sürükle.\nKalça ve omuz aynı anda kalksın.\nCore’u sık.',
    commonMistakes: 'Sırtı yuvarlamak (ciddi bel riski).\nBarı vücuttan uzak tutmak.\nKalçayı erken kaldırıp beli yormak.',
  },
  'Good Morning': {
    description:
      '🎯 Ana: Hamstring, Bel (erektör) · İkincil: Gluteus\n\nBar omuzda; dizler hafif bükülü, kalçayı geriye iterek gövdeyi öne eğ, kalçayı sıkarak doğrul.',
    tips: 'Sırtı düz tut.\nHareket kalçadan, belden değil.\nHafif ağırlıkla, kontrollü.',
    commonMistakes: 'Sırtı yuvarlamak.\nDizleri fazla büküp squat’a çevirmek.\nÇok ağırlık.',
  },
  'Cable Crunch': {
    description: '🎯 Ana: Karın (rektus abdominis) · İzole hareket\n\nHalat başın yanında diz çökerek; karnı sıkıp gövdeyi aşağı kıvır.',
    tips: 'Hareketi karından yap, kalçadan değil.\nEn altta sık.\nKontrollü geri dön.',
    commonMistakes: 'Kalçadan öne eğilmek.\nKolla çekmek.\nMomentum.',
  },
  'Russian Twist': {
    description:
      '🎯 Ana: Karın (yan/oblik) · İkincil: Core\n\nOturur, gövde hafif geride; ağırlığı iki yana kontrollü döndür.',
    tips: 'Sırtı düz tut, çökme.\nHareketi gövdeden döndür.\nKontrollü tempo.',
    commonMistakes: 'Sadece kolları sallamak.\nBeli yuvarlamak.\nÇok hızlı, kontrolsüz.',
  },
  'Cable Woodchopper': {
    description:
      '🎯 Ana: Karın (yan/oblik), Core · İkincil: Omuz\n\nKabloyu bir üst köşeden çapraz aşağı (ya da tersi) gövdeyi döndürerek çek.',
    tips: 'Hareketi gövdeden döndür, sadece koldan değil.\nCore’u sık.\nAyakları sabit, kalçadan dön.',
    commonMistakes: 'Sadece kollarla çekmek.\nBeli zorlamak.\nÇok ağırlıkla kontrolü kaybetmek.',
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
