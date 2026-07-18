// `pnpm setup:exercises` — seed the Fitness exercise library through the PRODUCT'S OWN domain path
// (upsertExercise → decide → transact → event), never hand-written Firestore. The catalogue is data
// (AD-41): these are the studio's real exercises, editable afterwards from the Antrenman screen.
//
// Idempotent by nameTr: it reads what exists first and passes the existing id, so a second run corrects
// in place rather than duplicating. Manual, admin-only, never in CI. Actor = platform_admin (#5).
//
// Videos/tips are intentionally blank — the owner fills them from the panel over time; the library
// works without them.
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
const BRANCH = process.argv[3] ?? 'mutlukent'

// nameTr = the gym-floor name Işıl uses (matches her programme sheets); muscleGroup + equipment are the
// filters the programme builder groups by. Order here = a sensible reading order, grouped by area.
const EXERCISES: readonly { nameTr: string; muscleGroup: string; equipment: string }[] = [
  // Göğüs
  { nameTr: 'Incline Chest Press', muscleGroup: 'Göğüs', equipment: 'Makine' },
  { nameTr: 'Chest Press (Düz)', muscleGroup: 'Göğüs', equipment: 'Makine' },
  { nameTr: 'Pec Fly (Peck Deck)', muscleGroup: 'Göğüs', equipment: 'Makine' },
  { nameTr: 'Cable Crossover', muscleGroup: 'Göğüs', equipment: 'Kablo' },
  // Omuz
  { nameTr: 'Shoulder Press', muscleGroup: 'Omuz', equipment: 'Makine' },
  { nameTr: 'Lateral Raise', muscleGroup: 'Omuz', equipment: 'Serbest Ağırlık' },
  { nameTr: 'Front Raise', muscleGroup: 'Omuz', equipment: 'Serbest Ağırlık' },
  { nameTr: 'Face Pull', muscleGroup: 'Omuz (Arka)', equipment: 'Kablo' },
  // Kol
  { nameTr: 'Triceps Pushdown (V-Bar)', muscleGroup: 'Kol (Triceps)', equipment: 'Kablo' },
  { nameTr: 'Triceps Pushdown (Halat)', muscleGroup: 'Kol (Triceps)', equipment: 'Kablo' },
  { nameTr: 'Dumbbell Biceps Curl', muscleGroup: 'Kol (Biceps)', equipment: 'Serbest Ağırlık' },
  { nameTr: 'Hammer Curl', muscleGroup: 'Kol (Biceps)', equipment: 'Serbest Ağırlık' },
  // Sırt
  { nameTr: 'Lat Pulldown', muscleGroup: 'Sırt', equipment: 'Makine' },
  { nameTr: 'Seated Cable Row', muscleGroup: 'Sırt', equipment: 'Kablo' },
  { nameTr: 'Single Arm Row', muscleGroup: 'Sırt', equipment: 'Kablo' },
  { nameTr: 'Straight-Arm Pulldown', muscleGroup: 'Sırt', equipment: 'Kablo' },
  // Kalça
  { nameTr: 'Hip Thrust', muscleGroup: 'Kalça', equipment: 'Makine' },
  { nameTr: 'Cable Glute Kickback', muscleGroup: 'Kalça', equipment: 'Kablo' },
  { nameTr: 'Reverse Hack Squat', muscleGroup: 'Kalça', equipment: 'Makine' },
  { nameTr: 'Glute Bridge (Kalça Köprüsü)', muscleGroup: 'Kalça', equipment: 'Serbest Ağırlık' },
  { nameTr: 'Frog Pump', muscleGroup: 'Kalça', equipment: 'Vücut Ağırlığı' },
  { nameTr: 'Cable Pull Through', muscleGroup: 'Kalça', equipment: 'Kablo' },
  { nameTr: 'Cable Abduction (Ayakta)', muscleGroup: 'Dış Kalça', equipment: 'Kablo' },
  // Bacak — Ön
  { nameTr: 'Leg Press', muscleGroup: 'Bacak (Ön)', equipment: 'Makine' },
  { nameTr: 'Leg Extension', muscleGroup: 'Bacak (Ön)', equipment: 'Makine' },
  { nameTr: 'Hack Squat', muscleGroup: 'Bacak (Ön)', equipment: 'Makine' },
  { nameTr: 'Smith Machine Squat', muscleGroup: 'Bacak (Ön)', equipment: 'Smith' },
  { nameTr: 'Sumo Squat', muscleGroup: 'Bacak (Ön)', equipment: 'Serbest Ağırlık' },
  { nameTr: 'Goblet Squat', muscleGroup: 'Bacak (Ön)', equipment: 'Serbest Ağırlık' },
  { nameTr: 'Bulgarian Split Squat', muscleGroup: 'Bacak (Ön)', equipment: 'Serbest Ağırlık' },
  { nameTr: 'Yürüyen Lunge', muscleGroup: 'Bacak (Ön)', equipment: 'Serbest Ağırlık' },
  { nameTr: 'Step Up', muscleGroup: 'Bacak (Ön)', equipment: 'Serbest Ağırlık' },
  // Bacak — Arka
  { nameTr: 'Leg Curl (Yatarak)', muscleGroup: 'Bacak (Arka)', equipment: 'Makine' },
  { nameTr: 'Seated Leg Curl', muscleGroup: 'Bacak (Arka)', equipment: 'Makine' },
  { nameTr: 'Deadlift', muscleGroup: 'Bacak (Arka)', equipment: 'Serbest Ağırlık' },
  { nameTr: 'Romanian Deadlift (RDL)', muscleGroup: 'Bacak (Arka)', equipment: 'Serbest Ağırlık' },
  { nameTr: 'Good Morning', muscleGroup: 'Bacak (Arka)', equipment: 'Serbest Ağırlık' },
  // İç / Dış bacak
  { nameTr: 'Adductor (İç Bacak)', muscleGroup: 'İç Bacak', equipment: 'Makine' },
  { nameTr: 'Abductor (Dış Kalça)', muscleGroup: 'Dış Kalça', equipment: 'Makine' },
  // Baldır / Bel
  { nameTr: 'Calf Raise (Baldır)', muscleGroup: 'Baldır', equipment: 'Makine' },
  { nameTr: 'Hyperextension', muscleGroup: 'Bel / Sırt Alt', equipment: 'Makine' },
  // Karın / Core
  { nameTr: 'Crunch', muscleGroup: 'Karın', equipment: 'Vücut Ağırlığı' },
  { nameTr: 'Cable Crunch', muscleGroup: 'Karın', equipment: 'Kablo' },
  { nameTr: 'Leg Raise (Bacak Kaldırma)', muscleGroup: 'Karın', equipment: 'Vücut Ağırlığı' },
  { nameTr: 'Russian Twist', muscleGroup: 'Karın (Yan)', equipment: 'Serbest Ağırlık' },
  { nameTr: 'Cable Woodchopper', muscleGroup: 'Karın (Yan)', equipment: 'Kablo' },
  { nameTr: 'Plank', muscleGroup: 'Karın', equipment: 'Vücut Ağırlığı' },
]

async function main(): Promise<void> {
  initializeApp({ projectId: PROJECT })
  const db: Firestore = getFirestore()

  const ctx: TenantContext = {
    studioId: STUDIO,
    branchIds: [BRANCH as never],
    role: 'owner',
    actor: { type: 'platform_admin', id: 'setup' as never },
  }
  const deps: TrainingDeps = { repo: new FirestoreTrainingRepository(db), clock: systemClock }

  // Idempotent by nameTr: pass the existing id so a re-run corrects in place, never duplicates.
  const existing = await deps.repo.listExercises(ctx)
  const idByName = new Map(existing.map((e) => [e.nameTr, e.id]))

  let created = 0
  let updated = 0
  for (const ex of EXERCISES) {
    const id = idByName.get(ex.nameTr)
    const input = id
      ? { id, nameTr: ex.nameTr, muscleGroup: ex.muscleGroup, equipment: ex.equipment, active: true }
      : { nameTr: ex.nameTr, muscleGroup: ex.muscleGroup, equipment: ex.equipment, active: true }
    const r = await upsertExercise(deps, ctx, input, 'reception_web')
    if (!r.ok) throw new Error(`${ex.nameTr} yazılamadı: ${r.error.code}`)
    if (id) updated++
    else created++
    console.log(`  ${id ? '~' : '+'} ${ex.nameTr}  ·  ${ex.muscleGroup}  ·  ${ex.equipment}`)
  }

  console.log(`\n✅ Egzersiz kütüphanesi: ${created} yeni, ${updated} güncellendi (toplam ${EXERCISES.length}).`)
  process.exit(0)
}

void main()
