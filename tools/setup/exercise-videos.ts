// `pnpm setup:exercise-videos` — attach a demonstration YouTube video to each library exercise, by
// nameTr, through the domain path (upsertExercise). Idempotent; a re-run corrects in place. The owner
// can change any link from the panel afterwards. Manual, admin-only, actor platform_admin (#5).
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

const yt = (id: string) => `https://www.youtube.com/watch?v=${id}`

// nameTr → demonstration video. `⭐` = owner-supplied (Işıl chose these; mostly the "demicstory"
// channel's clean form shorts, 2026-07-19). The rest are earlier best-effort candidates the owner may
// still swap from the panel. A shorts id works fine at watch?v= too, so `yt()` is used uniformly.
const VIDEOS: Readonly<Record<string, string>> = {
  'Incline Chest Press': yt('LiDArz1R2NU'),
  'Chest Press (Düz)': yt('rY0B8UFdne0'),
  'Pec Fly (Peck Deck)': yt('OdEwN1Ma3OQ'), // ⭐ owner
  'Cable Crossover': yt('hxveCzwK3p4'), // ⭐ owner (cable cross / chest fly)
  'Shoulder Press': yt('BAZkFGeUy5U'),
  'Lateral Raise': yt('Y29xKcze8Ik'),
  'Front Raise': yt('CH9JzDStL3U'),
  'Face Pull': yt('bfCAUl1gWmE'), // ⭐ owner (rear delt)
  'Triceps Pushdown (V-Bar)': yt('Up8QOILH_Ms'), // ⭐ owner (cable push down)
  'Triceps Pushdown (Halat)': yt('qHDrQglWgS4'),
  'Dumbbell Biceps Curl': yt('6DeLZ6cbgWQ'),
  'Hammer Curl': yt('8XLxfXROrTo'),
  'Lat Pulldown': yt('xJad-PjfyBE'), // ⭐ owner
  'Seated Cable Row': yt('HpgTMXSo-WQ'), // ⭐ owner
  'Single Arm Row': yt('QelgBRgIsjY'), // ⭐ owner (low cable bent-over row)
  'Straight-Arm Pulldown': yt('q3UbvOJu1JI'), // ⭐ owner (lat pushdown / cable pullover)
  'Hip Thrust': yt('I_neK5C5WA0'), // ⭐ owner
  'Cable Glute Kickback': yt('8Ir5yQ-T4po'), // ⭐ owner
  'Reverse Hack Squat': yt('YobwFd06p2k'), // ⭐ owner
  'Glute Bridge (Kalça Köprüsü)': yt('0od5lwWMGV8'),
  'Frog Pump': yt('rgljhH1X4vc'),
  'Cable Pull Through': yt('yXopOhzEoeo'),
  'Cable Abduction (Ayakta)': yt('bGlm-qTnfTI'),
  'Leg Press': yt('LTrVoFr5Sb0'), // ⭐ owner
  'Leg Extension': yt('-Ms11gRaCy0'), // ⭐ owner
  'Hack Squat': yt('-6KOCaoPA08'), // ⭐ owner
  'Smith Machine Squat': yt('RBCPr1PqMYY'), // ⭐ owner
  'Sumo Squat': yt('pcY33kEoKZ4'),
  'Goblet Squat': yt('JO7D6GJ98wY'),
  'Bulgarian Split Squat': yt('VPhhE6bBzZE'),
  'Yürüyen Lunge': yt('_DLIS8SySzs'),
  'Step Up': yt('aKj-6hgiViA'),
  'Leg Curl (Yatarak)': yt('ykKkuaeMhTk'), // ⭐ owner (horizontal leg curl)
  'Seated Leg Curl': yt('t9sTSr-JYSs'),
  'Deadlift': yt('ntr64W6ZWB0'),
  'Romanian Deadlift (RDL)': yt('aa57T45iFSE'),
  'Good Morning': yt('nWyx81AfTos'),
  'Adductor (İç Bacak)': yt('b9zDd7EgYgk'), // ⭐ owner
  'Abductor (Dış Kalça)': yt('b9zDd7EgYgk'), // ⭐ owner (same clip as adductor, per owner)
  'Calf Raise (Baldır)': yt('GAQ-oohMhog'),
  Hyperextension: yt('V7HN6K9D3xY'), // ⭐ owner
  Crunch: yt('0t4t3IpiEao'),
  'Cable Crunch': yt('aBd6T01PBqw'),
  'Leg Raise (Bacak Kaldırma)': yt('sY2ZgV2Sj_s'),
  'Russian Twist': yt('IJDOoVyVjhc'),
  'Cable Woodchopper': yt('he4IhLc1d5k'),
  Plank: yt('mwlp75MS6Rg'),
}

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

  const existing = await deps.repo.listExercises(ctx)
  const byName = new Map(existing.map((e) => [e.nameTr, e]))

  let set = 0
  const missing: string[] = []
  for (const [name, url] of Object.entries(VIDEOS)) {
    const ex = byName.get(name)
    if (!ex) {
      missing.push(name)
      continue
    }
    const r = await upsertExercise(deps, ctx, { id: ex.id, nameTr: ex.nameTr, videoUrl: url }, 'reception_web')
    if (!r.ok) throw new Error(`${name} videosu yazılamadı: ${r.error.code}`)
    set++
    console.log(`  ▸ ${name} → ${url}`)
  }
  if (missing.length) console.log(`\n⚠️  Kütüphanede bulunamayan (atlandı): ${missing.join(', ')}`)
  console.log(`\n✅ ${set} harekete video eklendi.`)
  process.exit(0)
}

void main()
