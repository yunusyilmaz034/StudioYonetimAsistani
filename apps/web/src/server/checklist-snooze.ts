import { FieldValue } from 'firebase-admin/firestore'

import { adminDb } from './firebase-admin'

// ── BİR KERE ARANAN ÜYE YARIN YENİDEN ARANMAZ (owner, 2026-09-03) ───────────────────────────
//
// *"2 üye uzaklaşıyor diyor ya, bir kere üstü çizildi; onu bugün tekrar aramak gibi bir iş olamaz.
// O yüzden 1 hafta kadar çıkarmaması lazım bunları."*
//
// A tick means two different things depending on the line, and the list used to treat them the same.
// "9 boş seans" is a fact about TODAY — tomorrow's empty session is a different session with a
// different id, and the tick is rightly gone by morning. "ESRA — 34 gündür gelmiyor · bir arayın" is
// not about today at all: it is a PHONE CALL, and a call made today is not undone by the sun coming
// up. Re-listing her tomorrow does not remind reception of work; it teaches her that the list lies,
// and a list that lies gets ticked without being read.
//
// So on those lines the tick starts a COOLDOWN: the item leaves the list for the days below and comes
// back only if the reason to call is STILL TRUE then.
//
// It is a cooldown, not a dismissal. Nothing is deleted and nothing is decided — if ESRA is still
// away next week the row returns, because the studio still has the problem. Un-ticking cancels it on
// the spot, so a mis-tick is one press from having the work back. And the list says out loud how many
// items are waiting out their week: an item that vanishes with no trace is the same lie in reverse.
//
// **This is not an event.** Like the tick itself, it is a working note about who is going to do what
// — no credit moves, no state changes, nothing downstream reads it.

/**
 * Kind → how many days a tick keeps it off the list. A kind that is NOT here keeps the old behaviour:
 * the tick lasts for the studio's day and the morning starts clean.
 *
 * The test for adding one: does the tick record a HUMAN CONTACT that stays made? A phone call does.
 * Filling an empty session does not — that class starts in three hours and is gone.
 */
export const CHECKLIST_COOLDOWN_DAYS: Readonly<Record<string, number>> = {
  // Bir hafta: aramanın sebebi bir TARİH değil, bir DAVRANIŞ. Yarın da 35 gündür gelmiyor olacak, ve
  // bu yeni bir haber değil.
  dormant_member: 7,
  // Bir hafta: borç ödenene kadar duruyor ve ödendiği an listeden zaten düşüyor. Her sabah aynı kişiyi
  // aramak tahsilat değil taciz; ertelemek de alacağı gizlemek değil — satır tahsilat ekranında duruyor.
  outstanding_balance: 7,
  // Bir hafta: yenileme bir satış konuşmasıdır. Üst üste günlerde aynı teklifi götürmek satışı değil
  // rahatsızlığı artırır.
  low_credit: 7,
  // Bir hafta (owner, 2026-09-04): *"tiklendiyse bir daha çıkmasın."* Aranmış bir lead ertesi gün
  // yeniden aranmaz — hele "8 gündür sessiz" diye listelenen biri. Bir hafta sonra hâlâ sessizse
  // satır geri gelir, çünkü o zaman gerçekten yeni bir iştir.
  hot_lead: 7,
  // ÜÇ gün, yedi değil — burada arkada bir SON TARİH var. Paket dolmadan bir gün önceki son hatırlatma
  // meşrudur; bir haftalık soğuma o hatırlatmayı yutardı, ve yanan hak geri gelmiyor.
  expiring_with_credits: 3,
  expiring_soon: 3,
}

export interface TickedItem {
  readonly id: string
  readonly kind: string
}

interface SnoozeEntry {
  readonly until: number
  readonly byName: string
  readonly at: number
}

const snoozeDoc = (studioId: string) => adminDb().doc(`studios/${studioId}/settings/checklistSnooze`)

const studioDay = (ms: number) => new Date(ms).toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' })

/**
 * Bu iş şu an listeden çıkarılır mı? SAF — testi burada, çünkü sınır burada: aynı gün HAYIR, ertesi gün
 * EVET, süre dolunca yine HAYIR.
 */
export function isSnoozedNow(entry: { until?: number; at?: number } | undefined, now: number): boolean {
  const until = Number(entry?.until ?? 0)
  if (until <= now) return false
  return studioDay(Number(entry?.at ?? 0)) !== studioDay(now)
}

/**
 * Şu an listeden çıkarılacak iş kimlikleri. Süresi geçenler okurken elenir — tek belge, tek okuma.
 *
 * TİKLENDİĞİ GÜN SATIR YERİNDE KALIR. Bu, 5 Ağustos'ta konmuş kuralın aynısı: *"tiklesin, gün sonunda
 * görsün ne kadar iş kapatmış"* — tik "bunu ben yaptım" demektir, "bu hiç yoktu" değil. Ayrıca tek geri
 * dönüş yolu budur: satır aynı gün gözden kaybolsaydı, yanlışlıkla atılmış bir tik işi bir haftalığına
 * kimsenin göremediği bir yere koyardı. Bugün üstü çizili durur, yarın gelmez.
 */
export async function loadSnoozedItemIds(studioId: string, now: number): Promise<ReadonlySet<string>> {
  try {
    const snap = await snoozeDoc(studioId).get()
    const items = (snap.data()?.items ?? {}) as Record<string, SnoozeEntry | undefined>
    return new Set(Object.entries(items).filter(([, v]) => isSnoozedNow(v, now)).map(([id]) => id))
  } catch {
    // A checklist that shows one row too many is a nuisance; a dashboard that fails to render is an
    // outage. If this read fails the desk simply sees the item again.
    return new Set()
  }
}

/**
 * Tik atıldığında soğumayı başlat, geri alındığında iptal et. Soğuması olmayan türler için hiçbir şey
 * yazılmaz — belge yalnızca gerçekten ertelenen işleri taşır.
 */
export async function applyChecklistCooldown(
  studioId: string,
  items: readonly TickedItem[],
  done: boolean,
  byName: string,
  now: number,
): Promise<void> {
  const affected = items.filter((it) => CHECKLIST_COOLDOWN_DAYS[it.kind] !== undefined)
  if (affected.length === 0) return

  const ref = snoozeDoc(studioId)
  const patch: Record<string, unknown> = {}
  for (const it of affected) {
    patch[`items.${it.id}`] = done
      ? { until: now + CHECKLIST_COOLDOWN_DAYS[it.kind]! * 86_400_000, byName, at: now }
      : FieldValue.delete()
  }
  // Expired keys are swept on the way past, so the document stays the size of the work actually
  // waiting rather than growing a row for every call ever made.
  const snap = await ref.get()
  const existing = (snap.data()?.items ?? {}) as Record<string, SnoozeEntry | undefined>
  for (const [id, v] of Object.entries(existing)) {
    if (patch[`items.${id}`] === undefined && Number(v?.until ?? 0) <= now) patch[`items.${id}`] = FieldValue.delete()
  }

  await ref.set({}, { merge: true })
  await ref.update(patch)
}
