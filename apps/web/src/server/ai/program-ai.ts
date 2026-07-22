import 'server-only'

import type { Exercise } from '@studio/core'

import type { AiProgramDay, AiProgramExercise, AiProgramResult, ProgramLevel } from '@/lib/training/ai-program'

// The AI programme designer (Phase 2). Given the studio's OWN exercise pool, a goal, a level and a day
// count, it drafts a multi-day training programme. It runs on-demand (a trainer presses "AI ile Öner"),
// so it is low-volume — worth a stronger model than the daily briefing.
//
// SAFETY — the same posture as the checklist narrator:
//  • No member PII is sent. The model sees ONLY the exercise catalogue (studio data, not personal) plus
//    the free-text goal/level/day-count the trainer typed. A member's name/measurements never leave.
//  • The model cannot invent an exercise: every returned exerciseId is validated against the pool and
//    dropped if it isn't there (like narrateChecklist drops invented items). It only ARRANGES our pool.
//  • It only PROPOSES. The trainer reviews, edits (add/remove/adjust) and accepts before anything is
//    assigned — nothing is committed by the model.

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
const MODEL = 'claude-sonnet-5' // structured multi-day generation benefits from a stronger model; low volume

const LEVEL_TR: Record<ProgramLevel, string> = { beginner: 'başlangıç', intermediate: 'orta', advanced: 'ileri' }

const SYSTEM = `Sen deneyimli bir fitness ve pilates antrenörüsün. Bir üye için, stüdyonun kendi egzersiz havuzunu kullanarak antrenman programı hazırlıyorsun.

MUTLAK KURALLAR:
- SADECE sana verilen havuzdaki egzersizleri kullan. Her egzersiz için havuzdaki "id" değerini AYNEN kullan. Havuzda olmayan egzersiz UYDURMA.
- Kas grubu (kas) ve ekipman bilgisine bakarak istenen odağa en uygun hareketleri seç, ama dengeli bir program kur.
- Gün sayısı tam olarak istenildiği kadar olsun.
- Seviye başlangıçsa: daha az hareket, daha az set, daha uzun dinlenme. İleri seviye: daha yoğun.
- Her güne genelde 4-7 hareket koy. Her hareket için: set (1-5 arası tam sayı), tekrar (metin: "12", "10-12", "15" gibi), dinlenme (saniye, tam sayı).
- Gün adlarını anlamlı yaz (ör. "Gün 1 — Alt Vücut & Kalça").
- Aynı egzersizi aynı günde iki kez koyma.

Yanıtı YALNIZCA şu JSON biçiminde ver — başında/sonunda hiçbir açıklama, markdown veya kod bloğu OLMASIN:
{"title":"program adı","days":[{"name":"Gün 1 — ...","exercises":[{"exerciseId":"HAVUZDAKI_ID","sets":3,"reps":"12","restSeconds":60,"note":""}]}]}`

function extractJson(text: string): string {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  return start >= 0 && end > start ? text.slice(start, end + 1) : text
}

const clampInt = (v: unknown, lo: number, hi: number, fallback: number): number => {
  const n = Math.round(Number(v))
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback
}

export function aiProgramConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY)
}

export async function aiBuildProgram(input: {
  readonly exercises: readonly Exercise[]
  readonly goal: string
  readonly level: ProgramLevel
  readonly days: number
}): Promise<AiProgramResult | null> {
  const key = process.env.ANTHROPIC_API_KEY
  const pool = input.exercises.filter((e) => e.active)
  if (!key || pool.length === 0) return null

  const byId = new Map(pool.map((e) => [e.id, e]))
  // Only the fields the model needs to CHOOSE — id, Turkish name, muscle group, equipment. No PII.
  const catalog = pool.map((e) => ({ id: e.id, ad: e.nameTr, kas: e.muscleGroup, ekipman: e.equipment }))
  const user = JSON.stringify({
    istek: { gunSayisi: input.days, seviye: LEVEL_TR[input.level], odak: input.goal.trim() || 'dengeli tüm vücut' },
    havuz: catalog,
  })

  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 4000,
        system: SYSTEM,
        messages: [{ role: 'user', content: user }],
      }),
      signal: AbortSignal.timeout(45_000),
    })
    if (!res.ok) return null
    const data = (await res.json()) as { content?: { text?: string }[] }
    const text = data.content?.[0]?.text
    if (!text) return null
    const parsed = JSON.parse(extractJson(text)) as {
      title?: string
      days?: { name?: string; exercises?: { exerciseId?: string; sets?: unknown; reps?: unknown; restSeconds?: unknown; note?: unknown }[] }[]
    }

    const days: AiProgramDay[] = []
    for (const d of parsed.days ?? []) {
      const seen = new Set<string>()
      const exercises: AiProgramExercise[] = []
      for (const e of d.exercises ?? []) {
        const lib = e.exerciseId ? byId.get(e.exerciseId) : undefined
        if (!lib || seen.has(lib.id)) continue // drop anything the model invented or duplicated
        seen.add(lib.id)
        exercises.push({
          exerciseId: lib.id,
          nameTr: lib.nameTr,
          sets: clampInt(e.sets, 1, 5, 3),
          reps: (typeof e.reps === 'string' && e.reps.trim()) || '12',
          restSeconds: clampInt(e.restSeconds, 0, 300, 60),
          note: typeof e.note === 'string' ? e.note.trim().slice(0, 200) : '',
        })
      }
      if (exercises.length > 0) days.push({ name: (d.name || `Gün ${days.length + 1}`).slice(0, 80), exercises })
    }
    if (days.length === 0) return null
    return { title: (parsed.title || '').trim().slice(0, 80), days, source: 'ai' }
  } catch {
    // Any failure (network, timeout, bad JSON) → null; the action falls back to the deterministic builder.
    return null
  }
}
