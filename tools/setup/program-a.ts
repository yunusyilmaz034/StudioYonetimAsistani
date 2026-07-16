// `pnpm setup:program-a` — create the studio's "Program A" template (level: beginner) through the
// domain path (upsertProgramTemplate), looking up exerciseIds from the seeded library by nameTr.
// Idempotent by template name. Manual, admin-only, ALLOW_PRODUCTION-gated, actor platform_admin.
//
// A template is CONFIG (no events); assigning it to a member later creates her event-sourced programme.
import {
  FirestoreTrainingRepository,
  listProgramTemplates,
  systemClock,
  upsertProgramTemplate,
  type StudioId,
  type TemplateDayInput,
  type TenantContext,
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

// "3x15" → 3 set, reps "15". "12-10-8-8" → 4 set (piramit), reps "12-10-8-8".
function parseSpec(spec: string): { sets: number; reps: string } {
  const m = /^(\d+)\s*x\s*(.+)$/i.exec(spec.trim())
  if (m) return { sets: Number(m[1]), reps: m[2]!.trim() }
  const parts = spec.split('-').map((s) => s.trim()).filter(Boolean)
  return { sets: parts.length, reps: spec.trim() }
}

// [exercise library name, set×tekrar spec] per day.
const PROGRAM_A: readonly { day: string; items: readonly [string, string][] }[] = [
  {
    day: 'Gün 1',
    items: [
      ['Incline Chest Press', '12-10-8-8'],
      ['Pec Fly (Peck Deck)', '3x12'],
      ['Triceps Pushdown (V-Bar)', '3x12'],
      ['Triceps Pushdown (Halat)', '3x12'],
      ['Shoulder Press', '12-10-8-6'],
      ['Lateral Raise', '3x15'],
      ['Front Raise', '3x15'],
    ],
  },
  {
    day: 'Gün 2',
    items: [
      ['Lat Pulldown', '3x12'],
      ['Seated Cable Row', '3x12'],
      ['Single Arm Row', '3x15'],
      ['Dumbbell Biceps Curl', '3x12'],
      ['Hammer Curl', '3x15'],
      ['Step Up', '3x12'],
      ['Crunch', '3x15'],
    ],
  },
  {
    day: 'Gün 3',
    items: [
      ['Leg Press', '3x15'],
      ['Hack Squat', '3x15'],
      ['Reverse Hack Squat', '3x20'],
      ['Abductor (Dış Kalça)', '3x20'],
      ['Adductor (İç Bacak)', '3x20'],
      ['Hip Thrust', '3x15'],
      ['Cable Glute Kickback', '3x20'],
      ['Deadlift', '3x15'],
    ],
  },
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

  // Resolve exercise ids from the seeded library by nameTr — FAIL loudly on any miss.
  const library = await deps.repo.listExercises(ctx)
  const idByName = new Map(library.map((e) => [e.nameTr, e.id]))
  const missing: string[] = []
  const days: TemplateDayInput[] = PROGRAM_A.map((d, di) => ({
    order: di + 1,
    name: d.day,
    exercises: d.items.map(([name, spec], xi) => {
      const exerciseId = idByName.get(name)
      if (!exerciseId) missing.push(name)
      const { sets, reps } = parseSpec(spec)
      return { exerciseId: exerciseId ?? 'MISSING', order: xi + 1, sets, reps }
    }),
  }))
  if (missing.length) {
    console.error(`Kütüphanede bulunamayan hareketler (önce pnpm setup:exercises): ${[...new Set(missing)].join(', ')}`)
    process.exit(1)
  }

  // Idempotent by name: pass the existing id so a re-run corrects in place.
  const existing = await listProgramTemplates(deps, ctx)
  const existingId = existing.find((t) => t.name === 'Program A')?.id

  const r = await upsertProgramTemplate(
    deps,
    ctx,
    { id: existingId, name: 'Program A', level: 'beginner', description: 'Stüdyo standart başlangıç programı.', days },
    'reception_web',
  )
  if (!r.ok) throw new Error(`Program A yazılamadı: ${r.error.code}`)
  console.log(`  ${existingId ? '~' : '+'} Program A  ·  3 gün  ·  ${days.reduce((n, d) => n + d.exercises.length, 0)} hareket  (${r.value.id})`)
  console.log('\n✅ Program A şablonu kuruldu.')
  process.exit(0)
}

void main()
