'use server'

import { FirestoreCrmRepository } from '@studio/core'
import { FieldValue } from 'firebase-admin/firestore'
import { z } from 'zod'

import { requireTenantContext } from '../auth'
import { adminDb } from '../firebase-admin'
import { narrateChecklist, type DailyChecklist } from '../ai/anthropic'
import { loadAiSettings } from './ai-settings'
import type { AdvisorItem } from '../advisor-query'
import { logInteractionAction } from './crm'
import type { TickedItem } from '../checklist-snooze'

// The dashboard (owner + reception) asks the AI to turn today's deterministic advisor items into a warm,
// prioritised checklist. Returns null when the AI key isn't configured or the call fails — the client
// then keeps showing the deterministic list. The items are the studio's OWN signals, passed from the
// server-rendered dashboard; the narrator tokenises names out before any model call.
const OPS = ['owner', 'receptionist', 'platform_admin'] as const

// The AI narration is regenerated at fixed studio times only (owner: 10:00, 14:00, 19:00 TRT — three
// times a day is enough) — NOT on every dashboard open — so cost is capped at ~3 calls/day. Within a
// slot the cached narration is served; the client keeps the underlying list fresh (drops resolved
// items, appends new ones) so mid-slot staleness never misleads the desk.
const SLOTS = [10, 14, 19]
function currentSlotKey(nowMs: number): string {
  const trt = new Date(nowMs + 3 * 3_600_000) // TRT = UTC+3, no DST
  const hour = trt.getUTCHours()
  let slot: number | null = null
  for (const s of SLOTS) if (hour >= s) slot = s
  if (slot === null) {
    // Before the first slot of the day → carry the previous day's last slot.
    const prev = new Date(nowMs + 3 * 3_600_000 - 86_400_000)
    return `${prev.toISOString().slice(0, 10)}:19`
  }
  return `${trt.toISOString().slice(0, 10)}:${slot}`
}

export async function narrateChecklistAction(items: readonly AdvisorItem[]): Promise<DailyChecklist | null> {
  const ctx = await requireTenantContext(OPS)
  if (items.length === 0) return null

  const slot = currentSlotKey(Date.now())
  const ref = adminDb().doc(`studios/${ctx.studioId}/settings/aiChecklist`)
  const snap = await ref.get()
  const cached = snap.data() as { slot?: string; checklist?: DailyChecklist } | undefined
  if (cached?.slot === slot && cached.checklist) return cached.checklist // same slot → no new AI call

  const ai = await loadAiSettings(ctx.studioId) // the studio's tone, set in Ayarlar → AI
  const result = await narrateChecklist(items, 'stüdyonuz', ai?.tone)
  if (result) {
    try {
      await ref.set({ slot, checklist: result, at: Date.now() }, { merge: true })
    } catch {
      /* cache write is best-effort — a failure just means we regenerate next load */
    }
  }
  return result
}

// ── KİM HANGİ İŞİ KAPATTI (owner, 2026-08-05) ───────────────────────────────────────────────
//
// The ticks used to live in `localStorage`, which made them a private note on one machine:
// reception ticked at the desk and the owner's phone showed nothing done. *"Kim ne iş kapattı,
// bunların bilgisi tutulsun."* So they move to the studio, with a name and a time on each one.
//
// ONE DOCUMENT PER DAY (`checklistDone/{yyyy-mm-dd}`), a map of itemId → who/when. One read to
// open the dashboard, one write per tick, no index, and un-ticking simply removes the key.
//
// **This is NOT an event.** Ticking a checklist line is a working note, not something that happened
// to the business — no credit moves, no state changes, nothing downstream reads it. Putting it in
// the append-only log would dilute the one place that is supposed to mean "this occurred". It is
// kept deliberately outside, and it is disposable: losing it costs a day's tick marks, nothing more.
export interface ChecklistDoneEntry {
  readonly itemId: string
  readonly byName: string
  readonly at: number
  /**
   * Tikle birlikte bırakılan kısa not — "aradım açmadı", "aradım gelecek" (owner, 2026-09-04).
   *
   * Bu, notun KALICI kaydı DEĞİLDİR. Lead için gerçek kayıt bir `Interaction`dır (kind `call`,
   * outcome `no_answer`/`callback`/`reached`) ve Satış Hunisi'nde durur. Buradaki kopya yalnızca
   * BUGÜNÜN ekranı için: satır listede kalırken yanında ne yazdığı görünsün. Tik kaydı zaten
   * atılabilir sayılıyor ("kaybı bir günlük tik işaretine mal olur"), ve bu not da onunla gider.
   */
  readonly note?: string
}

const doneDoc = (studioId: string, dayKey: string) =>
  adminDb().collection('studios').doc(studioId).collection('checklistDone').doc(dayKey)

export async function getChecklistDoneAction(dayKey: string): Promise<readonly ChecklistDoneEntry[]> {
  const ctx = await requireTenantContext(OPS)
  const snap = await doneDoc(ctx.studioId as string, dayKey).get()
  const map = (snap.data()?.items ?? {}) as Record<string, { byName?: string; at?: number; note?: string }>
  return Object.entries(map).map(([itemId, v]) => ({
    itemId,
    byName: v.byName ?? '—',
    at: Number(v.at ?? 0),
    ...(v.note ? { note: String(v.note) } : {}),
  }))
}

export async function setChecklistDoneAction(input: {
  dayKey: string
  /** Tiklenen işler. `kind` soğuma için gerekli: bir telefon görüşmesi ertesi gün geri gelmez. */
  items: readonly TickedItem[]
  done: boolean
  /** Tikle birlikte bırakılan not (owner, 2026-09-04). Yalnızca bugünün ekranı için. */
  note?: string
}): Promise<readonly ChecklistDoneEntry[]> {
  const ctx = await requireTenantContext(OPS)
  const ref = doneDoc(ctx.studioId as string, input.dayKey)
  // The desk's own name, so the row can say WHO closed it. The session claims carry no name, so the
  // staff record is read — one extra read on an action that fires a handful of times a day. A tick
  // with no name is still better than a tick with a wrong one, hence the id fallback.
  const uid = ctx.actor.id as string
  const staff = await adminDb().collection('studios').doc(ctx.studioId as string).collection('staff').doc(uid).get()
  const byName = (staff.data()?.displayName as string | undefined)?.trim() || uid
  const now = Date.now()

  // A merge write: two people ticking different lines at the same moment must not overwrite each
  // other, which a whole-document set would do.
  const patch: Record<string, unknown> = {}
  for (const it of input.items) {
    patch[`items.${it.id}`] = input.done
      ? { byName, at: now, ...(input.note?.trim() ? { note: input.note.trim().slice(0, 200) } : {}) }
      : FieldValue.delete()
  }
  await ref.set({}, { merge: true })
  await ref.update(patch)

  // SOĞUMA İÇİN AYRI BİR YAZIM YOK (2026-09-04). Bir süre listeden çıkacak işler, TİKİN KENDİSİNDEN
  // türetiliyor (`loadSnoozedItemIds`). Tik anında ikinci bir belgeye yazmak, soğumayı "o an ne
  // biliyorduk"a bağlıyordu: `hot_lead` soğuması eklendiğinde ondan ÖNCE tiklenmiş 25 lead ertesi gün
  // geri geldi. Türetmek geçmişe dönük çalışır ve sürüklenecek ikinci bir kayıt bırakmaz.

  return getChecklistDoneAction(input.dayKey)
}

// ── LEAD'İ ARADIM, SONUCU BU (owner, 2026-09-04) ────────────────────────────────────────────
//
// *"WhatsApp lead'lerini tiklendiyse bir daha çıkmasın, hatta bunlara not ekleyebilsin — 'aradım
// açmadı', 'aradım gelecek' gibi."*
//
// YENİ BİR KAVRAM UYDURULMADI. Bu tam olarak `Interaction`: `kind: 'call'` ve
// `outcome: 'reached' | 'no_answer' | 'callback'`. Model aylardır duruyordu ve bu ekran onu
// kullanmıyordu — bugünlerde üç kez tekrarlanan hatanın aynısı ("mekanizma var, çağıran yer yok").
//
// TEK EYLEM, İKİ YAZIM ve ikisi de bilinçli:
//  · `Interaction` — KALICI kayıt. Satış Hunisi'nde ve lead geçmişinde durur, bir hafta sonra satır
//    geri geldiğinde "geçen sefer ne olmuştu" sorusunun cevabı budur.
//  · Tik + kısa not — BUGÜNÜN ekranı. Satır listede üstü çizili kalırken yanında ne yazdığı görünsün.
//    Atılabilir, ve tik kaydının kendisi de öyle.
//
// Tek eylemde yapılıyor ki ikisi birbirinden ayrılmasın: not yazılıp arama kaydedilmezse, kalıcı
// olan taraf boş kalırdı.
export async function recordLeadCallAction(input: unknown) {
  const p = z
    .object({
      dayKey: z.string().min(1),
      itemId: z.string().min(1),
      phone: z.string().min(1),
      outcome: z.enum(['reached', 'no_answer', 'callback']),
      note: z.string().trim().max(200).default(''),
    })
    .parse(input)
  const ctx = await requireTenantContext(OPS)

  const OUTCOME_TR: Record<typeof p.outcome, string> = {
    reached: 'Arandı, görüşüldü',
    no_answer: 'Arandı, açmadı',
    callback: 'Arandı, gelecek',
  }
  // Metin BOŞ BIRAKILAMAZ (`logInteraction` reddediyor) — sonucun Türkçesi varsayılan. Resepsiyonun
  // her aramada bir cümle yazmaya mecbur olması, üç tıkla biten işi yazı işine çevirirdi.
  const text = p.note.trim() || OUTCOME_TR[p.outcome]

  // Lead'i TELEFONDAN buluyoruz: checklist satırı `wa:{phone}` kimliğini taşıyor, lead kimliğini
  // değil. Lead yoksa (sohbet var, huniye hiç düşmemiş) arama kaydı yazılmaz ama TİK YİNE ATILIR —
  // resepsiyonun işini, bizim veri modelimizin eksiği yüzünden geri çevirmeyiz.
  try {
    const leads = await new FirestoreCrmRepository(adminDb()).listLeads(ctx)
    const lead = leads.find((l) => l.phone === p.phone)
    if (lead) {
      await logInteractionAction({ kind: 'call', leadId: lead.id, memberId: null, text, outcome: p.outcome })
    }
  } catch {
    /* arama kaydı yazılamadıysa tik yine de atılır — ikisinden hangisinin daha değerli olduğu belli */
  }

  return setChecklistDoneAction({ dayKey: p.dayKey, items: [{ id: p.itemId, kind: 'hot_lead' }], done: true, note: text })
}
