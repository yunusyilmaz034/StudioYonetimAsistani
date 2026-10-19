import { FirestoreTrainingRepository, publishProgramVersion, systemClock, type DraftProgramDay, type TenantContext } from '@studio/core'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

// MERVE FİRDEVS USLU — KASIK YIRTIĞINA GÖRE PROGRAM, v4 (owner, 2026-10-19, aynı akşam üçüncü istek)
//
//   pnpm tsx tools/migration/program-merve-uslu-v4-2026-10-19.ts            # kuru çalışma
//   pnpm tsx tools/migration/program-merve-uslu-v4-2026-10-19.ts --apply    # yaz
//
// Owner: *"kasık yırtığı olan kadın için antrenman programını … ona göre yaz."* v2/v3 genel "güvenli"
// programdı (`program-merve-uslu-2026-10-19.ts`); bu sürüm kasığa göre kuruldu. Teşhisin evresi, tarafı,
// ameliyat olup olmadığı BİLİNMİYOR — o yüzden ilk iki hafta en temkinli hâliyle yazıldı, ilerleme notta.
//
// İlkeler:
//   · Kasığı YÜKLEYEN ya da GEREN hiçbir şey yok: adductor, abductor (uç noktada kasığı gerer), lunge,
//     split squat, step up, squat türleri, leg press/hack, sumo, deadlift/RDL/good morning.
//   · Karın içi basıncı artıran yok (fıtık ihtimaline karşı da): crunch, leg raise, cable crunch, russian
//     twist, woodchopper; ağırlıklar hafif, nefes tutmak yok.
//   · Bacaklar hep KALÇA GENİŞLİĞİNDE ve PARALEL; yana açma, içe bastırma yok.
//   · Pelvisi taşıyan kaslar güçlenir: kalça (bridge, geriye kickback), gövde (dead bug, bird dog).
//   · Hepsi oturarak/destekli; dönme hareketi yok (tek kol ayakta row çıkarıldı).
//   · Yüklenme: 1–2. hafta 2 set, zorluk 10 üzerinden 5–6; ağrı yoksa 3. haftadan 3 set.

const STUDIO = 'retro'
const RUN = 'program-merve-uslu-v4-2026-10-19'
const APPLY = process.argv.includes('--apply')
const PROGRAM_ID = 'prg_01M2WYH5M3RV01XNV9FSB9TC2Q'
const MEMBER_ID = 'mem_01M2WYFJWA3X2GQ7966G54ZN9R'

const X = {
  chestPress: 'exr_01KXN5J78EFWY0C4JQ2YQRR8DW',
  inclinePress: 'exr_01KXN5J727ZCBW1DTH3VAW0PW6',
  pecFly: 'exr_01KXN5J7CWXEM6QZ069Y3EZRJ7',
  seatedCableRow: 'exr_01KXN5J920GCP65RYYHSTP2TXZ',
  cableRow: 'J27SXtreQyVhrDlFs4mB',
  latPulldown: 'exr_01KXN5J8WKQJK9QY8G8NWH5QZN',
  shoulderPress: 'exr_01KXN5J7HJSCNZGMQGRXH7M9MP',
  lateralRaise: 'exr_01KXN5J7N4PRJH5W00747AHMS2',
  facePull: 'exr_01KXN5J7Y00DH8N5D11EQ8WRV9',
  tricepsRope: 'exr_01KXN5J87S90X5N52VF9Z9WZT8',
  hammerCurl: 'exr_01KXN5J8RN09X3CQPF16WA8695',
  bicepsCurl: 'exr_01KXN5J8MJAZAF7V3NJHES9AMR',
  legExtension: 'exr_01KXN5JAB46TG8N2HFF1AN6K2F',
  seatedLegCurl: 'exr_01KXN5JBRYTRDN1W4KFEG0XXAX',
  gluteBridge: 'exr_01KXN5J9PHW2YBQ2H78VX1CVGK',
  kickback: 'exr_01KXN5J9DRHSSF1PBK726GY8WN',
  calfRaise: 'exr_01KXN5JCFQR0SQBSMD5P2P89X0',
  deadBug: 'bnon8lm1LQr86wAUdB6t',
  birdDog: 'r0xBXEpn8vgXiCTWEXC5',
} as const

const ISINMA = 'ISINMA: önce 8–10 dk hafif tempolu bisiklet ya da yürüyüş bandı (konuşabileceğin hız). '
const NEFES = 'Nefesini tutma; ağırlığı kaldırırken/iterken nefes ver.'
const AGRI = 'Kasıkta ağrı ya da çekme hissedersen hareketi bırak, eğitmene söyle.'

type Satir = { id: string; sets: number; reps: string; rest: number; tempo?: string; note: string; alt?: string }
const gun = (order: number, name: string, satirlar: readonly Satir[]): DraftProgramDay => ({
  order,
  name,
  exercises: satirlar.map((s, i) => ({
    exerciseId: s.id, order: i + 1, sets: s.sets, reps: s.reps, restSeconds: s.rest, tempo: s.tempo ?? '2-0-2', note: s.note, alternativeExerciseId: s.alt ?? null,
  })),
})

const DAYS: readonly DraftProgramDay[] = [
  gun(1, '1. Gün — Üst Vücut + Gövde Dengesi', [
    { id: X.chestPress, sets: 2, reps: '12', rest: 75, alt: X.pecFly, note: `${ISINMA}Sırtın tamamen dayalı, ayaklar yere basık ve kalça genişliğinde. İterken nefes ver.` },
    { id: X.seatedCableRow, sets: 2, reps: '12', rest: 75, alt: X.cableRow, note: `Göğüs dik, kürekleri geriye sık. Gövdenle sallanma, dizler hafif bükülü. ${NEFES}` },
    { id: X.latPulldown, sets: 2, reps: '12', rest: 75, note: `Uyluk pedin altında sabit. Barı göğse çekerken nefes ver. ${NEFES}` },
    { id: X.shoulderPress, sets: 2, reps: '12', rest: 75, note: `Oturarak, sırt dayalı. Hafif ağırlık; beli kavislendirme. ${NEFES}` },
    { id: X.facePull, sets: 2, reps: '15', rest: 60, note: 'Ayaklar kalça genişliğinde, dizler hafif bükülü. Halatı yüze doğru çek, dirsekler yukarıda.' },
    { id: X.tricepsRope, sets: 2, reps: '12', rest: 60, note: `Dirsekler gövdeye yakın. Gövdeyi öne yatırma. ${NEFES}` },
    { id: X.deadBug, sets: 2, reps: '6 (her taraf)', rest: 60, tempo: '3-1-3', note: `Bel yere yapışık; kol ve karşı bacağı YAVAŞÇA uzat. Bacak düz uzansın, yana açılmasın. ${AGRI}` },
  ]),
  gun(2, '2. Gün — Alt Vücut (Kasık Dostu)', [
    { id: X.legExtension, sets: 2, reps: '12', rest: 75, note: `${ISINMA}Dizler kalça genişliğinde ve paralel; dizleri içe bastırma ya da açma. ${NEFES}` },
    { id: X.seatedLegCurl, sets: 2, reps: '12', rest: 75, note: `Bacaklar paralel, kalça genişliğinde. Hafif ağırlık, kontrollü dönüş. ${AGRI}` },
    { id: X.gluteBridge, sets: 2, reps: '12', rest: 60, tempo: '2-2-2', note: `Ağırlıksız. Ayaklar ve dizler kalça genişliğinde, paralel. Tepede kalçayı sık, 2 sn tut. ${AGRI}` },
    { id: X.kickback, sets: 2, reps: '12 (her taraf)', rest: 60, note: `Makineden tutun. Bacağı YALNIZCA geriye, düz götür; yana açma. Hafif ağırlık. ${AGRI}` },
    { id: X.calfRaise, sets: 2, reps: '15', rest: 45, note: 'Ayaklar kalça genişliğinde. Tepede 1 sn bekle, yavaş in.' },
    { id: X.birdDog, sets: 2, reps: '6 (her taraf)', rest: 60, tempo: '3-2-3', note: `Kalça sabit, dönmesin. Bacağı geriye düz uzat, yana açma. 2 sn tut. ${AGRI}` },
  ]),
  gun(3, '3. Gün — Tüm Vücut (Hafif)', [
    { id: X.inclinePress, sets: 2, reps: '12', rest: 75, alt: X.chestPress, note: `${ISINMA}Sırt dayalı, ayaklar yere basık. ${NEFES}` },
    { id: X.cableRow, sets: 2, reps: '12', rest: 75, alt: X.seatedCableRow, note: `Göğüs dik, gövde sabit. ${NEFES}` },
    { id: X.lateralRaise, sets: 2, reps: '12', rest: 60, note: 'Oturarak yap. Hafif dumbbell, omuz hizasına kadar.' },
    { id: X.legExtension, sets: 2, reps: '15', rest: 60, note: `1. günden daha hafif. Dizler paralel. ${NEFES}` },
    { id: X.gluteBridge, sets: 2, reps: '15', rest: 60, tempo: '2-2-2', note: `Ağırlıksız, dizler paralel. ${AGRI}` },
    { id: X.hammerCurl, sets: 2, reps: '12', rest: 60, alt: X.bicepsCurl, note: `Oturarak yap. ${NEFES}` },
    { id: X.deadBug, sets: 2, reps: '6 (her taraf)', rest: 60, tempo: '3-1-3', note: `Bel yere yapışık, yavaş. ${AGRI}` },
  ]),
]

const NOTE =
  'Kasık için düzenlendi. Haftada 3 gün, aralarda en az 1 gün dinlenme. 1–2. hafta her hareket 2 set, zorluk 10 ' +
  'üzerinden 5–6 (rahat konuşabileceğin kadar). Ağrı yoksa 3. haftadan itibaren 3 set. Hareket sırasında ya da ertesi ' +
  'gün kasıkta ağrı, şişlik ya da çekme olursa o hareketi bırak ve eğitmene söyle. Doktorunun söyledikleri her zaman önce gelir.'

async function main(): Promise<void> {
  initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID ?? 'studio-yonetim-prod' })
  const db = getFirestore()
  const ctx = {
    studioId: STUDIO,
    actor: { type: 'platform_admin', id: `migration:${RUN}` },
    branchIds: [],
    correlationId: RUN,
    source: 'migration',
    role: 'platform_admin',
  } as unknown as TenantContext
  const deps = { repo: new FirestoreTrainingRepository(db), clock: systemClock }
  const dur = (m: string): never => { console.error(`DUR: ${m}`); process.exit(1) }

  const program = await deps.repo.getProgram(ctx, PROGRAM_ID)
  if (!program || program.memberId !== MEMBER_ID) return dur('program tanıdaki gibi değil.')
  const library = new Map((await deps.repo.listExercises(ctx)).map((e) => [e.id, e]))
  for (const d of DAYS) for (const x of d.exercises) {
    for (const id of [x.exerciseId, x.alternativeExerciseId]) {
      if (id && !library.get(id)?.active) return dur(`havuzda yok/pasif: ${id}`)
    }
  }
  const zatenVar = program.versions.some((v) => v.note === NOTE)

  console.log(`━━ ${program.title} · v${program.currentVersion} → v${program.currentVersion + 1} · ${APPLY ? 'UYGULANIYOR' : 'KURU ÇALIŞMA'}${zatenVar ? ' — ZATEN YAYINDA' : ''}`)
  for (const d of DAYS) {
    console.log(`\n   ${d.name}`)
    for (const x of d.exercises) console.log(`     ${x.order}. ${library.get(x.exerciseId)!.nameTr} · ${x.sets}×${x.reps} · ${x.restSeconds} sn · tempo ${x.tempo}${x.alternativeExerciseId ? ` · alt: ${library.get(x.alternativeExerciseId)!.nameTr}` : ''}`)
  }
  if (!APPLY || zatenVar) { if (!APPLY) console.log('\n   --apply ile çalıştır.'); return }

  const r = await publishProgramVersion(deps, ctx, { programId: PROGRAM_ID, days: DAYS, note: NOTE }, 'migration' as never)
  if (!r.ok) return dur(JSON.stringify(r.error))
  console.log(`\n✅ yayında · v${r.value.currentVersion} · ${r.value.status}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
