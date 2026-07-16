// `pnpm setup:exercise-images` — give each exercise a START + FINISH photo (PF-11 images). Source:
// free-exercise-db (github.com/yuhonas/free-exercise-db, The Unlicense / public domain — free to use AND
// redistribute), so the images are committed into the app's own `public/exercises/<id>/` and served
// statically (no Firebase Storage, no CDN, no CSP issue). We match our exercises to the DB by name,
// download the two images, and write photoUrl/gifUrl through the domain path (upsertExercise), preserving
// the existing text guidance + video. Idempotent; a re-run refreshes. Manual, admin-only, never in CI.
import {
  FirestoreTrainingRepository,
  systemClock,
  upsertExercise,
  type Exercise,
  type StudioId,
  type TenantContext,
  type TrainingDeps,
} from '@studio/core'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const PROJECT = process.env.GCLOUD_PROJECT ?? 'demo-sos'
if (!process.env.FIRESTORE_EMULATOR_HOST && !process.env.ALLOW_PRODUCTION) {
  console.error('Refusing to run against production without ALLOW_PRODUCTION=1.')
  process.exit(1)
}
const STUDIO = (process.argv[2] ?? 'retro') as StudioId
const RAW = 'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main'
const PUBLIC_DIR = join(process.cwd(), 'apps/web/public/exercises')

// Turkish/ambiguous → an English hint that matches the free-exercise-db naming.
const OVERRIDE: Record<string, string> = {
  'Yürüyen Lunge': 'Walking Lunge',
  'Leg Raise (Bacak Kaldırma)': 'Lying Leg Raise',
  'Calf Raise (Baldır)': 'Standing Calf Raises',
  'Leg Curl (Yatarak)': 'Lying Leg Curls',
  'Abductor (Dış Kalça)': 'Thigh Abductor',
  'Adductor (İç Bacak)': 'Thigh Adductor',
  'Pec Fly (Peck Deck)': 'Butterfly',
  'Chest Press (Düz)': 'Dumbbell Bench Press',
  'Incline Chest Press': 'Incline Dumbbell Press',
  'Lateral Raise': 'Side Lateral Raise',
  'Front Raise': 'Front Dumbbell Raise',
  'Shoulder Press': 'Dumbbell Shoulder Press',
  'Dumbbell Biceps Curl': 'Dumbbell Bicep Curl',
  'Single Arm Row': 'One-Arm Dumbbell Row',
  'Seated Cable Row': 'Seated Cable Rows',
  'Lat Pulldown': 'Wide-Grip Lat Pulldown',
  'Sumo Squat': 'Plie Dumbbell Squat',
  Deadlift: 'Barbell Deadlift',
  'Leg Extension': 'Leg Extensions',
  Crunch: 'Crunches',
  'Cable Pull Through': 'Pull Through',
  'Hip Thrust': 'Barbell Hip Thrust',
  Hyperextension: 'Hyperextensions',
  'Bulgarian Split Squat': 'Split Squat with Dumbbells',
  'Cable Glute Kickback': 'Glute Kickback',
  'Cable Woodchopper': 'Standing Cable Wood Chop',
  'Reverse Hack Squat': 'Hack Squat',
}
const tok = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean)

async function download(url: string, dest: string): Promise<void> {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`download ${r.status} ${url}`)
  writeFileSync(dest, Buffer.from(await r.arrayBuffer()))
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

  const res = await fetch(`${RAW}/dist/exercises.json`)
  const dbEx = ((await res.json()) as { name: string; images: string[] }[]).filter((e) => e.images?.length)
  const dbTok = dbEx.map((e) => ({ e, t: new Set(tok(e.name)) }))
  const match = (name: string): { name: string; images: string[] } | null => {
    const qt = tok(OVERRIDE[name] ?? name.replace(/\(.*?\)/g, ''))
    let best: { e: { name: string; images: string[] }; extra: number } | null = null
    for (const { e, t } of dbTok) {
      if (!qt.every((x) => t.has(x))) continue
      const extra = t.size - qt.length
      if (!best || extra < best.extra) best = { e, extra }
    }
    return best?.e ?? null
  }

  const existing = await deps.repo.listExercises(ctx)
  let done = 0
  const miss: string[] = []
  for (const ex of existing as readonly Exercise[]) {
    const m = match(ex.nameTr)
    if (!m) {
      miss.push(ex.nameTr)
      continue
    }
    const dir = join(PUBLIC_DIR, ex.id)
    mkdirSync(dir, { recursive: true })
    const photoUrl = `/exercises/${ex.id}/0.jpg`
    await download(`${RAW}/exercises/${m.images[0]}`, join(dir, '0.jpg'))
    let gifUrl: string | null = null
    if (m.images[1]) {
      await download(`${RAW}/exercises/${m.images[1]}`, join(dir, '1.jpg'))
      gifUrl = `/exercises/${ex.id}/1.jpg`
    }
    // Upsert with EVERY existing field preserved + the new image URLs (photoUrl = start, gifUrl = finish).
    const r = await upsertExercise(
      deps,
      ctx,
      {
        id: ex.id,
        nameTr: ex.nameTr,
        nameEn: ex.nameEn,
        muscleGroup: ex.muscleGroup,
        equipment: ex.equipment,
        active: ex.active,
        description: ex.description,
        tips: ex.tips,
        commonMistakes: ex.commonMistakes,
        videoUrl: ex.videoUrl,
        photoUrl,
        gifUrl,
        alternativeExerciseIds: ex.alternativeExerciseIds,
      },
      'reception_web',
    )
    if (!r.ok) throw new Error(`${ex.nameTr}: ${r.error.code}`)
    done++
    console.log(`  ✓ ${ex.nameTr} → ${m.name} (${m.images.length} görsel)`)
  }
  console.log(`\n✅ ${done} egzersize görsel eklendi${miss.length ? `, ${miss.length} eşleşmedi: ${miss.join(', ')}` : ''}.`)
  process.exit(0)
}

void main()
