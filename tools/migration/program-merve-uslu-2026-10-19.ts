import { FirestoreTrainingRepository, publishProgramVersion, systemClock, type DraftProgramDay, type TenantContext } from '@studio/core'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

// MERVE FİRDEVS USLU — HAVUZDAN, KARIN İÇİ BASINCI DÜŞÜK PROGRAM (owner, 2026-10-19)
//
//   pnpm tsx tools/migration/program-merve-uslu-2026-10-19.ts            # kuru çalışma
//   pnpm tsx tools/migration/program-merve-uslu-2026-10-19.ts --apply    # yaz
//
// Owner: *"ona göre bir program atasan, havuzdaki hareketlere bak, atamasını yap sen ata; eksik gedik
// düzeltmeyi biz yaparız."* Sağlık durumu owner'ın sözünde; bu dosyada da, sürüm notunda da, olayda da
// adı geçmiyor (olay yükü yalnızca gün/hareket sayısı taşır).
//
// Elindeki "Program A" (toplu atanan genel şablon) SİLİNMEZ: aynı programa yeni sürüm yayınlanır,
// v1 geçmişte kalır (OR-64). Yayın üyeye "programın güncellendi" bildirimi gider.
//
// Seçim ilkesi: makine/destekli, sırt dayalı, hafif–orta ağırlık. Dışarıda bırakılanlar: ağır bileşik
// (deadlift, RDL, good morning, squat türleri, leg press, hack), kasık bölgesini geren (adductor, lunge,
// bulgarian, step up), karın basıncını artıran (crunch, cable crunch, leg raise, russian twist,
// woodchopper), karın üstü yatarak (leg curl yatarak, hyperextension). Karın için dead bug + bird dog.

const STUDIO = 'retro'
const RUN = 'program-merve-uslu-2026-10-19'
const APPLY = process.argv.includes('--apply')
const PROGRAM_ID = 'prg_01M2WYH5M3RV01XNV9FSB9TC2Q'
const MEMBER_ID = 'mem_01M2WYFJWA3X2GQ7966G54ZN9R'

const NEFES = 'Nefesini tutma: ağırlığı kaldırırken nefes ver. Hafif–orta ağırlık, zorlanmadan.'
type Satir = readonly [id: string, sets: number, reps: string, rest: number, note?: string]
const gun = (order: number, name: string, satirlar: readonly Satir[]): DraftProgramDay => ({
  order,
  name,
  exercises: satirlar.map(([exerciseId, sets, reps, restSeconds, note], i) => ({
    exerciseId, order: i + 1, sets, reps, restSeconds, tempo: '', note: note ?? NEFES, alternativeExerciseId: null,
  })),
})

const DAYS: readonly DraftProgramDay[] = [
  gun(1, '1. Gün — Üst Vücut', [
    ['exr_01KXN5J78EFWY0C4JQ2YQRR8DW', 3, '12', 60], // Chest Press (Düz)
    ['exr_01KXN5J920GCP65RYYHSTP2TXZ', 3, '12', 60], // Seated Cable Row
    ['exr_01KXN5J7HJSCNZGMQGRXH7M9MP', 2, '12', 60, 'Oturarak, sırt dayalı. Hafif ağırlık; nefesini tutma.'], // Shoulder Press
    ['exr_01KXN5J7N4PRJH5W00747AHMS2', 2, '15', 45], // Lateral Raise
    ['exr_01KXN5J87S90X5N52VF9Z9WZT8', 2, '12', 45], // Triceps Pushdown (Halat)
    ['exr_01KXN5J8MJAZAF7V3NJHES9AMR', 2, '12', 45, 'Oturarak yap. Nefesini tutma.'], // Dumbbell Biceps Curl
    ['bnon8lm1LQr86wAUdB6t', 2, '8 (her taraf)', 45, 'Bel yere yapışık, yavaş. Karnını şişirme, nefes ritmik.'], // Dead Bug
  ]),
  gun(2, '2. Gün — Alt Vücut', [
    ['exr_01KXN5JAB46TG8N2HFF1AN6K2F', 3, '12', 60], // Leg Extension
    ['exr_01KXN5JBRYTRDN1W4KFEG0XXAX', 3, '12', 60], // Seated Leg Curl
    ['exr_01KXN5J9PHW2YBQ2H78VX1CVGK', 3, '12', 60, 'Önce ağırlıksız. Kalçayı sık, beli zorlama; nefesini tutma.'], // Glute Bridge
    ['exr_01KXN5JCC9Q47HG1XZ79MAP3PX', 2, '15', 45], // Abductor (Dış Kalça)
    ['exr_01KXN5J9DRHSSF1PBK726GY8WN', 2, '12 (her taraf)', 45], // Cable Glute Kickback
    ['exr_01KXN5JCFQR0SQBSMD5P2P89X0', 3, '15', 45], // Calf Raise
    ['r0xBXEpn8vgXiCTWEXC5', 2, '8 (her taraf)', 45, 'Yavaş, gövde sabit. Nefes ritmik.'], // Bird Dog
  ]),
  gun(3, '3. Gün — Tüm Vücut', [
    ['exr_01KXN5J8WKQJK9QY8G8NWH5QZN', 3, '12', 60], // Lat Pulldown
    ['exr_01KXN5J7CWXEM6QZ069Y3EZRJ7', 2, '12', 60], // Pec Fly
    ['exr_01KXN5J7Y00DH8N5D11EQ8WRV9', 2, '15', 45], // Face Pull
    ['exr_01KXN5JAB46TG8N2HFF1AN6K2F', 2, '12', 60], // Leg Extension
    ['exr_01KXN5J9PHW2YBQ2H78VX1CVGK', 2, '12', 60, 'Ağırlıksız. Nefesini tutma.'], // Glute Bridge
    ['exr_01KXN5J8RN09X3CQPF16WA8695', 2, '12', 45, 'Oturarak yap. Nefesini tutma.'], // Hammer Curl
    ['bnon8lm1LQr86wAUdB6t', 2, '8 (her taraf)', 45, 'Bel yere yapışık, yavaş. Karnını şişirme, nefes ritmik.'], // Dead Bug
  ]),
]

const NOTE = 'Owner talebiyle düzenlendi: makine ağırlıklı, hafif–orta yük, nefes tutmadan. Eğitmen gözden geçirecek.'

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
    const e = library.get(x.exerciseId)
    if (!e || !e.active) return dur(`havuzda yok/pasif: ${x.exerciseId}`)
  }
  const zatenVar = program.versions.some((v) => v.note === NOTE)

  console.log(`━━ ${program.title} · v${program.currentVersion} → v${program.currentVersion + 1} · ${APPLY ? 'UYGULANIYOR' : 'KURU ÇALIŞMA'}${zatenVar ? ' — ZATEN YAYINDA' : ''}`)
  for (const d of DAYS) {
    console.log(`\n   ${d.name}`)
    for (const x of d.exercises) console.log(`     ${x.order}. ${library.get(x.exerciseId)!.nameTr} · ${x.sets}×${x.reps} · ${x.restSeconds} sn`)
  }
  if (!APPLY || zatenVar) { if (!APPLY) console.log('\n   --apply ile çalıştır.'); return }

  const r = await publishProgramVersion(deps, ctx, { programId: PROGRAM_ID, days: DAYS, note: NOTE }, 'migration' as never)
  if (!r.ok) return dur(JSON.stringify(r.error))
  console.log(`\n✅ yayında · v${r.value.currentVersion} · ${r.value.status}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
