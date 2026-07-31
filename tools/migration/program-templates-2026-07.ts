// BREAK-GLASS — the studio's real starter programme (owner, 2026-07-31).
//
//   pnpm tsx tools/migration/program-templates-2026-07.ts <studioId>            ← dry run
//   pnpm tsx tools/migration/program-templates-2026-07.ts <studioId> --apply
//
// ── Why ─────────────────────────────────────────────────────────────────────────────────────
//
// "Program A" in this system turned out to be the ADVANCED plan, and it was assigned to sixty-five
// fitness members overnight. The real starter programme lives on a printed sheet at the desk. So:
//
//   1. the existing "Program A" becomes "İleri Program A" — the name now says what it is;
//   2. the printed starter sheet becomes the new "Program A";
//   3. its rotation becomes "Program B" — same three days, started a day later. Deliberate, and
//      confirmed as such: a member who sees both sees the same three workouts in a different order;
//   4. every wrongly-assigned programme is ARCHIVED, not deleted — and the member view now filters
//      archived out, so she sees one plan and not two;
//   5. the new "Program A" is assigned to every fitness member who has none.
//
// ── The part that reaches people ────────────────────────────────────────────────────────────
//
// Assignment publishes a version, which notifies the member. The owner's standing rule is that BULK
// operations notify nobody, so every intent this run creates is cancelled immediately afterwards —
// the same thing done by hand on 2026-07-31, made part of the operation this time.
import { randomBytes } from 'node:crypto'

import { initializeApp } from 'firebase-admin/app'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'

import {
  FirestoreTrainingRepository,
  instantiateTemplate,
  systemClock,
  type MigrationRunId,
  type StudioId,
  type TenantContext,
} from '@studio/core'

const studioId = (process.argv[2] ?? '') as StudioId
const apply = process.argv.includes('--apply')
if (!studioId) {
  console.error('kullanım: program-templates-2026-07.ts <studioId> [--apply]')
  process.exit(1)
}

initializeApp({ projectId: process.env.GCLOUD_PROJECT ?? 'demo-sos' })
const db = getFirestore()
const ctx: TenantContext = {
  studioId,
  branchIds: [],
  role: 'owner',
  actor: { type: 'migration', id: 'mig_program_templates_20260731' as MigrationRunId },
}

// ── The five the library does not have. Written to match what is already there. ──────────────
const NEW_EXERCISES = [
  {
    nameTr: 'Cable Row',
    muscleGroup: 'Sırt',
    equipment: 'Makine',
    description: '🎯 Ana: Sırt (orta) · İkincil: Biceps, Arka omuz\n\nOturarak kolu gövdeye doğru çek, kürek kemiklerini birbirine yaklaştır, kontrollü bırak.',
  },
  {
    nameTr: 'Pushdown',
    muscleGroup: 'Kol (Triceps)',
    equipment: 'Makine',
    description: '🎯 Ana: Triceps\n\nDirsekler gövdeye sabit, barı aşağı it, kolu tam aç, kontrollü geri bırak.',
  },
  {
    nameTr: 'Rope Pushdown',
    muscleGroup: 'Kol (Triceps)',
    equipment: 'Makine',
    description: '🎯 Ana: Triceps (dış baş)\n\nHalatı aşağı it ve sonda iki yana aç. Dirsekler sabit kalsın.',
  },
  {
    nameTr: 'Dead Bug',
    muscleGroup: 'Karın',
    equipment: 'Mat',
    description: '🎯 Ana: Derin karın (transversus) · İkincil: Bel stabilizasyonu\n\nSırtüstü, bel yere yapışık. Karşı kol ve bacağı yavaşça uzat, geri topla. Bel boşluk yapmasın.',
  },
  {
    nameTr: 'Bird Dog',
    muscleGroup: 'Bel / Sırt Alt',
    equipment: 'Mat',
    description: '🎯 Ana: Bel stabilizasyonu · İkincil: Kalça, Omuz\n\nEmekleme pozisyonunda karşı kol ve bacağı uzat, 2 saniye tut, kontrollü indir. Kalça dönmesin.',
  },
] as const

// ── The three days on the printed sheet. Program B is the same three, rotated by one. ────────
type Day = { name: string; items: [string, string][] }

const DAY_LEG_PRESS: Day = {
  name: '1. Gün',
  items: [
    ['Leg Press', '3x15'], ['Lat Pulldown', '3x12'], ['Dumbbell Biceps Curl', '3x12'],
    ['Abductor (Dış Kalça)', '3x20'], ['Hip Thrust', '3x15'], ['Dead Bug', '3x15'], ['Step Up', '3x12'],
  ],
}
const DAY_LEG_CURL: Day = {
  name: '2. Gün',
  items: [
    ['Leg Curl (Yatarak)', '3x15'], ['Cable Row', '3x12'], ['Dumbbell Biceps Curl', '3x12'],
    ['Adductor (İç Bacak)', '3x20'], ['Glute Bridge (Kalça Köprüsü)', '3x20'], ['Bird Dog', '3x15'], ['Crunch', '3x15'],
  ],
}
const DAY_LEG_EXT: Day = {
  name: '3. Gün',
  items: [
    ['Leg Extension', '3x15'], ['Pec Fly (Peck Deck)', '3x12'], ['Pushdown', '3x12'], ['Rope Pushdown', '3x12'],
    ['Abductor (Dış Kalça)', '3x20'], ['Hip Thrust', '3x15'], ['Plank', '3x30 sn'], ['Step Up', '3x12'],
  ],
}

const PROGRAM_A: Day[] = [DAY_LEG_PRESS, DAY_LEG_CURL, DAY_LEG_EXT]
const PROGRAM_B: Day[] = [DAY_LEG_CURL, DAY_LEG_EXT, DAY_LEG_PRESS]

const fold = (s: string): string => s.toLocaleLowerCase('tr').replace(/[^a-z0-9]/g, '')
const parseSets = (s: string): { sets: number; reps: string } => {
  const m = /^(\d+)x(.+)$/.exec(s)
  return { sets: Number(m?.[1] ?? 3), reps: (m?.[2] ?? s).trim() }
}

async function main(): Promise<void> {
  console.log(apply ? 'UYGULANIYOR\n' : 'KURU PROVA — hiçbir şey yazılmıyor\n')

  // ── 1. exercises ──────────────────────────────────────────────────────────────────────────
  const exSnap = await db.collection(`studios/${studioId}/exercises`).get()
  const byName = new Map(exSnap.docs.map((d) => [fold(String(d.data().nameTr ?? '')), d.id]))
  const toCreate = NEW_EXERCISES.filter((e) => !byName.has(fold(e.nameTr)))
  console.log(`hareket kütüphanesi: ${exSnap.size} · eklenecek: ${toCreate.length} (${toCreate.map((e) => e.nameTr).join(', ') || '—'})`)

  if (apply) {
    for (const e of toCreate) {
      const ref = db.collection(`studios/${studioId}/exercises`).doc()
      await ref.set({
        id: ref.id, studioId, nameTr: e.nameTr, nameEn: '', description: e.description,
        muscleGroup: e.muscleGroup, equipment: e.equipment, active: true,
        createdAt: FieldValue.serverTimestamp(),
      })
      byName.set(fold(e.nameTr), ref.id)
    }
  } else {
    for (const e of toCreate) byName.set(fold(e.nameTr), `(yeni:${e.nameTr})`)
  }

  const build = (days: Day[]) =>
    days.map((d, i) => ({
      order: i + 1,
      name: d.name,
      exercises: d.items.map(([name, sr], j) => {
        const id = byName.get(fold(name))
        if (!id) throw new Error(`Hareket bulunamadı: ${name}`)
        const { sets, reps } = parseSets(sr)
        return { exerciseId: id, order: j + 1, sets, reps, restSeconds: 60, tempo: null, note: null, alternativeExerciseId: null }
      }),
    }))

  const aDays = build(PROGRAM_A)
  const bDays = build(PROGRAM_B)
  console.log(`Program A: ${aDays.map((d) => d.exercises.length).join('+')} hareket · Program B: ${bDays.map((d) => d.exercises.length).join('+')}`)

  // ── 2. rename the old template ────────────────────────────────────────────────────────────
  const tplSnap = await db.collection(`studios/${studioId}/programTemplates`).get()
  const old = tplSnap.docs.find((d) => String(d.data().name ?? '') === 'Program A')
  console.log(`\nmevcut şablon: ${tplSnap.size} · "Program A" → "İleri Program A": ${old ? 'evet' : 'bulunamadı'}`)
  // The level moves with the name: a template called "İleri" that still says `beginner` shows a
  // "Başlangıç" badge, which is the opposite of what it now is.
  if (apply && old) await old.ref.set({ name: 'İleri Program A', level: 'advanced' }, { merge: true })

  // ── 3. the two new templates ──────────────────────────────────────────────────────────────
  for (const [name, days] of [['Program A', aDays], ['Program B', bDays]] as const) {
    const existing = tplSnap.docs.find((d) => String(d.data().name ?? '') === name && d.id !== old?.id)
    console.log(`  ${existing ? 'güncellenecek' : 'oluşturulacak'}: ${name}`)
    if (!apply) continue
    // THE WHOLE DECLARED SHAPE, not the four fields the screen happened to need. Writing a partial
    // document left both templates reading "Pasif" (no `active`) and badge-less (no `level`), and
    // the id skipped the `ptpl_` prefix every other id in this system carries (2026-07-31).
    const ref = existing ? existing.ref : db.collection(`studios/${studioId}/programTemplates`).doc(`ptpl_${randomBytes(13).toString('hex').toUpperCase()}`)
    await ref.set({
      id: ref.id,
      studioId,
      name,
      level: 'beginner',
      description: name === 'Program A'
        ? 'Stüdyo başlangıç programı — 3 gün, dönüşümlü.'
        : 'Başlangıç programının ikinci haftası — aynı üç gün, bir gün kaydırılmış.',
      days,
      active: true,
      updatedBy: 'mig_program_templates_20260731',
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true })
  }

  // ── 4. archive what the earlier run assigned ──────────────────────────────────────────────
  const progSnap = await db.collection(`studios/${studioId}/programs`).get()
  const wrong = progSnap.docs.filter((d) => {
    const x = d.data()
    return String(x.title ?? '') === 'Program A' && x.status !== 'archived' && String(x.trainerId ?? '').startsWith('mig_')
  })
  console.log(`\narşivlenecek (dünkü hatalı atama): ${wrong.length}`)
  // `status` alone. An `archivedAt` written here rides through `programFrom` — which spreads the
  // document and converts only createdAt/updatedAt — and reaches a Client Component as a raw
  // Firestore Timestamp, which React refuses. The member workspace's programme list then span for
  // ever with no error on screen (2026-07-31). The archive date is already in the event log.
  if (apply) for (const d of wrong) await d.ref.set({ status: 'archived' }, { merge: true })

  // ── 5. assign the new Program A ───────────────────────────────────────────────────────────
  const now = Date.now()
  const ents = await db.collection(`studios/${studioId}/entitlements`).where('status', '==', 'active').get()
  const fitness = new Set<string>()
  for (const d of ents.docs) {
    const x = d.data()
    if (x.productSnapshot?.category !== 'fitness') continue
    const until = x.validUntil?.toMillis?.() ?? Number(x.validUntil ?? 0)
    if (until > now && x.memberId) fitness.add(String(x.memberId))
  }
  const stillHas = new Set(
    progSnap.docs.filter((d) => d.data().status !== 'archived' && !wrong.some((w) => w.id === d.id))
      .map((d) => String(d.data().memberId ?? '')),
  )
  const targets = [...fitness].filter((m) => !stillHas.has(m))
  console.log(`fitness üyesi: ${fitness.size} · programı olan (dokunulmayacak): ${fitness.size - targets.length} · atanacak: ${targets.length}`)

  if (!apply) {
    console.log('\nKURU PROVA bitti. Uygulamak için --apply')
    process.exit(0)
  }

  const tplAfter = await db.collection(`studios/${studioId}/programTemplates`).get()
  const newA = tplAfter.docs.find((d) => String(d.data().name ?? '') === 'Program A')
  if (!newA) throw new Error('Yeni Program A bulunamadı')

  const deps = { repo: new FirestoreTrainingRepository(db), clock: systemClock }
  let ok = 0
  for (const memberId of targets) {
    const res = await instantiateTemplate(
      deps, ctx,
      { templateId: newA.id as never, memberId: memberId as never, trainerId: 'mig_program_templates_20260731' as never },
      'migration',
    )
    if (res.ok) ok++
    else console.log(`  ⚠️  ${memberId}: ${res.error.code}`)
  }
  console.log(`\n✅ ${ok} üyeye yeni Program A atandı.`)

  // ── 6. a bulk operation notifies nobody (owner rule) ──────────────────────────────────────
  const intents = await db.collection(`studios/${studioId}/notificationIntents`)
    .where('templateId', '==', 'program_published').get()
  const mine = intents.docs.filter((d) => {
    const at = d.data().createdAt?.toDate?.() ?? new Date(0)
    return at.getTime() >= now && d.data().cancelled !== true
  })
  for (const d of mine) {
    await d.ref.set({ cancelled: true, cancelReason: 'toplu işlem — bildirim üretilmez (OR-20)', cancelledAt: FieldValue.serverTimestamp() }, { merge: true })
  }
  console.log(`🔕 ${mine.length} bildirim iptal edildi (toplu işlem sessizdir).`)
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
