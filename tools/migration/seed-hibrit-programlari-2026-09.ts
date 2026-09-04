import { FirestoreTrainingRepository, upsertProgramTemplate, systemClock, type TenantContext } from '@studio/core'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

// HİBRİT PAKET SAHİPLERİ İÇİN İKİ ŞABLON — "Hibrit 1" (1 gün) · "Hibrit 2" (2 gün).
//
//   pnpm tsx tools/migration/seed-hibrit-programlari-2026-09.ts
//   pnpm tsx tools/migration/seed-hibrit-programlari-2026-09.ts --apply
//
// ── NEDEN (owner, 2026-09-04) ───────────────────────────────────────────────────────────────
//
// *"Hibrit paketlerde fitness'a gelenler 1 gün ya da 2 gün geliyor, bunlara program lazım. Bu arada
// bunlar güçsüz kadınlar, ona göre yap."*
//
// Stüdyodaki üç şablon (Program A/B, İleri Program A) ÜÇ GÜNLÜK. Haftada bir gelen birine üç günlük
// bir program vermek, programın üçte birini yapmasını istemektir — ve o kişi hangi üçte biri
// yapacağını kendi seçer. Yani bugün hibrit üyesi ya yanlış programı alıyor ya hiç almıyor.
//
// ── PROGRAM MANTIĞI ─────────────────────────────────────────────────────────────────────────
//
// **Hibrit 1 — haftada tek gün: TÜM VÜCUT.** Bölünmüş program tek günde işe yaramaz; kişi haftada bir
// kez antrenman yapıyorsa o antrenman her şeye dokunmalı. Sıra ağırdan hafife: en çok kas kullanan
// hareket, kişi en dinçken yapılır.
//
// **Hibrit 2 — haftada iki gün: ALT / ÜST.** İki gün, iki yarıya bölmeye yeter ve bölmek her bölgeye
// daha fazla iş düşürür. Aynı bölgeyi iki gün üst üste çalışmadığı için gün sırası da serbesttir.
//
// **Güçsüz başlangıç için üç seçim, üçü de bilinçli:**
//  · **Makine ağırlıklı.** Serbest ağırlık denge ve teknik ister; makine hareketin yolunu kendisi
//    çiziyor, yani gözetimsiz bir günde bile yanlış yapılması zor.
//  · **12–15 tekrar, 60–75 sn dinlenme.** Düşük tekrar + ağır yük, formu henüz oturmamış birinde
//    riski artırır. Yüksek tekrar hem tekniği tekrar ettirir hem kondisyonu toparlar.
//  · **Tempo `2-0-2`.** Yeni başlayan ağırlığı düşürür ve sallar; sayılan bir tempo bunu kendi başına
//    engelliyor, birinin başında durmasına gerek kalmadan.
//
// **`alternativeExerciseId` boş bırakılmadı:** Chest Press (Düz)'ün alternatifi Incline Chest Press.
// Owner'ın yeni aldığı **multi press** makinesi bu üç pozisyonu da yapıyor (düz · eğik · omuz); üçünü
// aynı güne koymak yeni başlayan bir kadında göğüs/omuzu şişirip sırtı aç bırakırdı. Alternatif
// alanı tam bunun için var: makine doluysa ya da kişi sıkıldıysa aynı işi eğik pozisyonda yapar.
//
// ── EGZERSİZ KÜTÜPHANESİNE EKLEME YAPILMADI, ÇÜNKÜ GEREKMEDİ ────────────────────────────────
//
// Owner *"multi press aldık, incline / normal chest press / shoulder press'i de ekle"* dedi. Ölçüldü:
// **üçü de kütüphanede zaten var**, aktif, ve alanları eksiksiz dolu (açıklama, ipuçları, sık yapılan
// hatalar, video, fotoğraf, gif). Kopyalarını eklemek kütüphaneyi bozardı: aynı hareketin iki kaydı,
// programı yazan kişiye hangisini seçeceğini sorar ve iki üye aynı hareketi farklı adla görür.

const STUDIO = 'retro'
const APPLY = process.argv.includes('--apply')

// Kütüphaneden OKUNAN kimlikler (2026-09-04). Ad yazıp aramak yerine kimlik sabitlendi: bir egzersiz
// yeniden adlandırılırsa script sessizce yanlış hareketi seçmesin, GÜRÜLTÜYLE dursun.
const EX = {
  legPress: 'exr_01KXN5JA5DG623KYZZ47AZQV1K',
  hipThrust: 'exr_01KXN5J99ZXKTHSMPJMRCT3MHJ',
  legCurl: 'exr_01KXN5JBD7MCZX56V624S1AHNK',
  legExtension: 'exr_01KXN5JAB46TG8N2HFF1AN6K2F',
  latPulldown: 'exr_01KXN5J8WKQJK9QY8G8NWH5QZN',
  chestPress: 'exr_01KXN5J78EFWY0C4JQ2YQRR8DW',
  inclinePress: 'exr_01KXN5J727ZCBW1DTH3VAW0PW6',
  shoulderPress: 'exr_01KXN5J7HJSCNZGMQGRXH7M9MP',
  abductor: 'exr_01KXN5JCC9Q47HG1XZ79MAP3PX',
  adductor: 'exr_01KXN5JC8JQ776QAAWDTXVK9PR',
  calfRaise: 'exr_01KXN5JCFQR0SQBSMD5P2P89X0',
  lateralRaise: 'exr_01KXN5J7N4PRJH5W00747AHMS2',
  bicepsCurl: 'exr_01KXN5J8MJAZAF7V3NJHES9AMR',
  ropePushdown: 'XDt1crE20XNPPG477rBV',
  cableRow: 'J27SXtreQyVhrDlFs4mB',
  deadBug: 'bnon8lm1LQr86wAUdB6t',
  plank: 'exr_01KXN5JD74B0T07W6ETDT63JC2',
} as const

const T = '2-0-2'
type Ex = { exerciseId: string; order: number; sets: number; reps: string; restSeconds: number; tempo: string; note: string; alternativeExerciseId: string | null }
const ex = (
  exerciseId: string,
  order: number,
  sets: number,
  reps: string,
  restSeconds: number,
  note: string,
  tempo: string = T,
  alternativeExerciseId: string | null = null,
): Ex => ({ exerciseId, order, sets, reps, restSeconds, tempo, note, alternativeExerciseId })

// ── HİBRİT 1 · haftada tek gün, tüm vücut ───────────────────────────────────────────────────
const HIBRIT1 = [
  {
    order: 1,
    name: 'Tüm Vücut',
    exercises: [
      ex(EX.legPress, 1, 3, '15', 75, 'Isınma seti yap: ilk set çok hafif. Dizler ayak ucu hizasında.'),
      ex(EX.hipThrust, 2, 3, '15', 75, 'Yukarıda kalçayı bir saniye sık. Bel değil kalça çalışsın.'),
      ex(EX.legCurl, 3, 3, '12', 60, 'Ön bacağı çalıştırdın; arkasını atlamak dizi dengesiz bırakır.'),
      ex(EX.latPulldown, 4, 3, '12', 60, 'Kolla değil sırtla çek; dirsekleri cebe doğru indir.'),
      ex(EX.chestPress, 5, 3, '12', 60, 'Multi press. Omuz hizasından ileri it, dirsekleri kilitleme.', T, EX.inclinePress),
      ex(EX.shoulderPress, 6, 3, '12', 60, 'Multi press. Beli çukurlaştırma, karnı sık.'),
      ex(EX.abductor, 7, 3, '15', 45, 'Kalça yan kası — yürüyüş ve merdivende dengeyi bu tutar.'),
      ex(EX.plank, 8, 3, '20-30 sn', 45, 'Süre değil DÜZLÜK önemli: kalça düşerse seti bitir.', ''),
    ],
  },
]

// ── HİBRİT 2 · haftada iki gün, alt / üst ───────────────────────────────────────────────────
const HIBRIT2 = [
  {
    order: 1,
    name: '1. Gün — Alt Vücut & Kalça',
    exercises: [
      ex(EX.legPress, 1, 3, '15', 75, 'Isınma seti yap: ilk set çok hafif.'),
      ex(EX.hipThrust, 2, 3, '15', 75, 'Yukarıda bir saniye sık. Bu programın en önemli hareketi.'),
      ex(EX.legCurl, 3, 3, '12', 60, 'Arka bacak. Ön bacakla dengeli olmalı.'),
      ex(EX.legExtension, 4, 3, '12', 60, 'Yukarıda kilitleme, dizi zorlama.'),
      ex(EX.abductor, 5, 3, '15', 45, 'Dış kalça.'),
      ex(EX.adductor, 6, 3, '15', 45, 'İç bacak. Dışını çalıştırıp içini atlamak dengesizlik yapar.'),
      ex(EX.calfRaise, 7, 2, '15', 45, 'Tam yukarı, tam aşağı.'),
      ex(EX.plank, 8, 3, '20-30 sn', 45, 'Kalça düşerse seti bitir.', ''),
    ],
  },
  {
    order: 2,
    name: '2. Gün — Üst Vücut & Karın',
    exercises: [
      ex(EX.chestPress, 1, 3, '12', 60, 'Multi press (düz). Kürekleri sıkıp sabitle.', T, EX.inclinePress),
      ex(EX.latPulldown, 2, 3, '12', 60, 'Sırtla çek. Duruş için en değerli hareket.'),
      ex(EX.shoulderPress, 3, 3, '12', 60, 'Multi press (omuz). Beli koru.'),
      ex(EX.cableRow, 4, 3, '12', 60, 'Kürekleri birbirine yaklaştır, omuzları kulağa kaldırma.'),
      ex(EX.lateralRaise, 5, 2, '15', 45, 'ÇOK HAFİF başla. Dirsek hafif bükük, omuz hizasını geçme.'),
      ex(EX.bicepsCurl, 6, 2, '12', 45, 'Gövdeyi sallama.'),
      ex(EX.ropePushdown, 7, 2, '12', 45, 'Dirsekler gövdeye sabit.'),
      ex(EX.deadBug, 8, 3, '10', 45, 'Bel mindere yapışık kalsın — kalkıyorsa hareketi küçült.', ''),
    ],
  },
]

async function main(): Promise<void> {
  initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID ?? 'studio-yonetim-prod' })
  const db = getFirestore()
  const ctx = {
    studioId: STUDIO,
    actor: { type: 'platform_admin', id: 'migration:seed-hibrit-programlari-2026-09' },
    branchIds: ['mutlukent'],
    role: 'platform_admin',
  } as unknown as TenantContext
  const deps = { repo: new FirestoreTrainingRepository(db), clock: systemClock }

  // KÜTÜPHANE DOĞRULAMASI — yazmadan önce. Bir kimlik tutmuyorsa script DURUR: yanlış hareket taşıyan
  // bir şablon, bir eğitmenin fark etmesi en zor hatasıdır (ad doğru görünür, hareket yanlıştır).
  const library = await deps.repo.listExercises(ctx)
  const varOlan = new Set(library.filter((e) => e.active).map((e) => e.id))
  const eksik = Object.entries(EX).filter(([, id]) => !varOlan.has(id))
  if (eksik.length > 0) {
    console.error('DUR — kütüphanede bulunamayan egzersiz:', eksik.map(([k, v]) => `${k}=${v}`).join(', '))
    process.exit(1)
  }
  const adi = new Map(library.map((e) => [e.id, e.nameTr]))

  const sablonlar = [
    {
      name: 'Hibrit 1',
      description:
        'Haftada TEK gün fitness’e gelen hibrit üyeler için tüm vücut programı. Makine ağırlıklı, 12–15 tekrar, yeni başlayan kadınlar için. Tek antrenman her bölgeye dokunmalı — bu yüzden bölünmüş değil, tüm vücut.',
      days: HIBRIT1,
    },
    {
      name: 'Hibrit 2',
      description:
        'Haftada İKİ gün fitness’e gelen hibrit üyeler için alt/üst bölünmüş program. Makine ağırlıklı, 12–15 tekrar, yeni başlayan kadınlar için. Günlerin sırası serbest; aynı bölge üst üste çalışılmıyor.',
      days: HIBRIT2,
    },
  ]

  console.log(APPLY ? '── YAZILIYOR ──\n' : '── KURU ÇALIŞMA ──\n')
  for (const s of sablonlar) {
    console.log(`━━ ${s.name} · ${s.days.length} gün`)
    for (const g of s.days) {
      console.log(`   ${g.name}`)
      for (const x of g.exercises) {
        const alt = x.alternativeExerciseId ? ` (alt: ${adi.get(x.alternativeExerciseId)})` : ''
        console.log(`      ${x.order}. ${adi.get(x.exerciseId)} — ${x.sets}×${x.reps} · ${x.restSeconds}sn${alt}`)
      }
    }
    if (!APPLY) { console.log(''); continue }
    const r = await upsertProgramTemplate(deps, ctx, { name: s.name, level: 'beginner', description: s.description, days: s.days }, 'staff')
    if (!r.ok) { console.error('   BAŞARISIZ:', r.error); process.exit(1) }
    console.log(`   ✓ ${r.value.id}\n`)
  }
  if (!APPLY) console.log('(uygulamak için --apply)')
}

void main()
