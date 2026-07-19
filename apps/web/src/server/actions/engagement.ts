'use server'

import { FirestoreEntitlementRepository, FirestoreMemberRepository, FirestoreReservationRepository, instant, lastActivityAt } from '@studio/core'
import { z } from 'zod'

import { requireTenantContext } from '../auth'
import { adminDb } from '../firebase-admin'

// ── "STÜDYODAN" ENGAGEMENT (v1.27) — the living content library + audience segments that turn the app
//    into a daily bond, not just a booking screen. Content is owner-editable config
//    (studios/{sid}/engagementContent). Sending reuses the notification pipeline (notify → inbox +
//    push, preference-aware) via the `engagement_broadcast` passthrough template. ──

const OWNER = ['owner', 'platform_admin'] as const
const OPS = ['owner', 'receptionist', 'platform_admin'] as const

export type EngagementCategory = 'motivation' | 'birthday' | 'missed' | 'welcome' | 'cancellation' | 'milestone' | 'campaign' | 'custom'
export type SegmentKey = 'all' | 'fitness' | 'pilates' | 'pt' | 'dormant' | 'regular' | 'cancellers' | 'new' | 'birthday'

export interface EngagementContent {
  readonly id: string
  readonly category: EngagementCategory
  readonly title: string // internal label
  readonly subject: string // what the member sees as the headline
  readonly body: string
  readonly updatedAt: number
}

export interface SegmentInfo {
  readonly key: SegmentKey
  readonly label: string
  readonly count: number
}

const col = (studioId: string) => adminDb().collection('studios').doc(studioId).collection('engagementContent')
const DAY = 86_400_000

// ── Content library CRUD ──
export async function listEngagementContentAction(): Promise<readonly EngagementContent[]> {
  const ctx = await requireTenantContext(OPS)
  const snap = await col(ctx.studioId).get()
  return snap.docs
    .map((d) => {
      const x = d.data()
      return {
        id: d.id,
        category: String(x.category ?? 'custom') as EngagementCategory,
        title: String(x.title ?? ''),
        subject: String(x.subject ?? ''),
        body: String(x.body ?? ''),
        updatedAt: Number(x.updatedAt ?? 0),
      }
    })
    .sort((a, b) => a.category.localeCompare(b.category) || a.title.localeCompare(b.title, 'tr'))
}

export async function upsertEngagementContentAction(input: unknown) {
  const p = z
    .object({
      id: z.string().optional(),
      category: z.enum(['motivation', 'birthday', 'missed', 'welcome', 'cancellation', 'milestone', 'campaign', 'custom']),
      title: z.string().trim().min(1),
      subject: z.string().trim().min(1).max(120),
      body: z.string().trim().min(1).max(600),
    })
    .parse(input)
  const ctx = await requireTenantContext(OWNER)
  const ref = p.id ? col(ctx.studioId).doc(p.id) : col(ctx.studioId).doc()
  const { id: _omit, ...fields } = p
  void _omit
  await ref.set({ ...fields, updatedAt: Date.now() }, { merge: true })
  return { ok: true as const, value: { id: ref.id } }
}

export async function deleteEngagementContentAction(input: unknown) {
  const p = z.object({ id: z.string().min(1) }).parse(input)
  const ctx = await requireTenantContext(OWNER)
  await col(ctx.studioId).doc(p.id).delete()
  return { ok: true as const }
}

export async function seedEngagementContentAction() {
  const ctx = await requireTenantContext(OWNER)
  const existing = await col(ctx.studioId).limit(1).get()
  if (!existing.empty) return { ok: false as const, error: { code: 'already_seeded' as const } }
  const batch = adminDb().batch()
  const now = Date.now()
  DEFAULT_CONTENT.forEach((c) => batch.set(col(ctx.studioId).doc(), { ...c, updatedAt: now }))
  await batch.commit()
  return { ok: true as const, value: { count: DEFAULT_CONTENT.length } }
}

// ── Audience segments. Two reads (members + active entitlements), everything else in memory — no
//    composite index (the prod-index trap). Returns the member ids for a segment. ──
async function loadAudience(studioId: string) {
  const ctx = { studioId } as never
  const now = Date.now()
  const [members, ents, recentRes] = await Promise.all([
    new FirestoreMemberRepository(adminDb()).list(ctx),
    new FirestoreEntitlementRepository(adminDb()).listActive(ctx),
    // Last 90 days of reservations — to flag "sürekli iptal edenler" without a per-member query.
    new FirestoreReservationRepository(adminDb()).listBySessionStartRange(ctx, instant(now - 90 * DAY), instant(now + 30 * DAY)),
  ])
  const active = members.filter((m) => m.status === 'active')
  const catByMember = new Map<string, Set<string>>()
  for (const e of ents) {
    const set = catByMember.get(e.memberId as string) ?? new Set<string>()
    set.add(e.productSnapshot.category)
    catByMember.set(e.memberId as string, set)
  }
  const cancelCount = new Map<string, number>()
  const recentCancelIds = new Set<string>()
  for (const r of recentRes) {
    if (r.status === 'cancelled' || r.status === 'late_cancelled') {
      cancelCount.set(r.memberId as string, (cancelCount.get(r.memberId as string) ?? 0) + 1)
      if (now - Number(r.sessionStartsAt) < 3 * DAY && Number(r.sessionStartsAt) <= now) recentCancelIds.add(r.memberId as string)
    }
  }
  const cancellerIds = new Set([...cancelCount.entries()].filter(([, n]) => n >= 3).map(([id]) => id))
  return { active, catByMember, cancellerIds, recentCancelIds }
}

const NOW = () => Date.now()

function membersInSegment(
  segment: SegmentKey,
  audience: Awaited<ReturnType<typeof loadAudience>>,
): string[] {
  const { active, catByMember, cancellerIds } = audience
  const now = NOW()
  const isMonthDayToday = (birth: string | null): boolean => {
    if (!birth) return false
    const t = new Date()
    return birth.slice(5) === `${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`
  }
  return active
    .filter((m) => {
      const id = m.id as string
      const cats = catByMember.get(id)
      const recency = lastActivityAt(m.stats) ?? Number(m.joinedAt)
      const daysSince = (now - recency) / DAY
      const daysMember = (now - Number(m.joinedAt)) / DAY
      switch (segment) {
        case 'all':
          return true
        case 'fitness':
          return cats?.has('fitness') ?? false
        case 'pilates':
          return cats?.has('pilates_group') ?? false
        case 'pt':
          return cats?.has('private') ?? false
        case 'dormant':
          return (cats?.size ?? 0) > 0 && daysSince >= 14 // aktif paketi var ama 2+ haftadır gelmiyor
        case 'regular':
          return daysSince <= 7
        case 'cancellers':
          return cancellerIds.has(id)
        case 'new':
          return daysMember <= 30
        case 'birthday':
          return isMonthDayToday((m.birthDate as string | null) ?? null)
        default:
          return false
      }
    })
    .map((m) => m.id as string)
}

export async function resolveSegment(studioId: string, segment: SegmentKey): Promise<string[]> {
  return membersInSegment(segment, await loadAudience(studioId))
}

const SEGMENT_LABEL: Record<SegmentKey, string> = {
  all: 'Tüm üyeler',
  fitness: 'Fitness paketi olanlar',
  pilates: 'Pilates paketi olanlar',
  pt: 'PT paketi olanlar',
  dormant: 'Uzun süredir gelmeyenler',
  regular: 'Disiplinli gelenler',
  cancellers: 'Sürekli iptal edenler',
  new: 'Yeni üyeler (30 gün)',
  birthday: 'Bugün doğum günü',
}

// Live counts for the composer — so the owner sees "Fitness paketi olanlar (23)" before sending.
export async function segmentCountsAction(): Promise<readonly SegmentInfo[]> {
  const ctx = await requireTenantContext(OPS)
  const audience = await loadAudience(ctx.studioId)
  return (Object.keys(SEGMENT_LABEL) as SegmentKey[]).map((key) => ({
    key,
    label: SEGMENT_LABEL[key],
    count: membersInSegment(key, audience).length,
  }))
}

// ── ÖNERİLER (live behavioural suggestions) — computed from existing data, NEVER auto-sent. The owner
//    reviews each (or "hepsini gönder"), and a cooldown log stops the same nudge repeating. ──
const MILESTONES = [10, 25, 50, 100, 200, 365]
const SUG_LABEL: Record<string, string> = {
  birthday: '🎂 Doğum günü',
  milestone: '🏅 Kilometre taşı',
  cancellation: '🙁 İptal geri bildirimi',
  missed: '💛 Seni özledik',
  welcome: '👋 Hoş geldin',
}
type SugType = 'birthday' | 'milestone' | 'cancellation' | 'missed' | 'welcome'
const FALLBACK: Record<SugType, { subject: string; body: string }> = {
  birthday: { subject: 'İyi ki doğdun! 🎉', body: 'Bugün senin günün — tüm ekiple doğum gününü kutluyoruz! 🎂' },
  milestone: { subject: 'Tebrikler! 🎉', body: 'Bu istikrar takdire değer — seninle gurur duyuyoruz!' },
  cancellation: { subject: 'Dersini kaçırdığına üzüldük', body: 'Bir aksilik mi oldu? Sana daha uygun bir zaman bulmak isteriz.' },
  missed: { subject: 'Seni özledik 🌸', body: 'Bir süredir yoktun, iyi misin? Sana uygun bir gün ayarlayalım, kapımız hep açık.' },
  welcome: { subject: 'Aramıza hoş geldin! 🤗', body: 'Seni aramızda görmek çok güzel. İlk dersini planlayalım!' },
}
const CAT_OF: Record<SugType, EngagementCategory> = { birthday: 'birthday', milestone: 'milestone', cancellation: 'cancellation', missed: 'missed', welcome: 'welcome' }

export interface EngagementSuggestion {
  readonly id: string
  readonly type: SugType
  readonly typeLabel: string
  readonly memberId: string
  readonly memberName: string
  readonly reason: string
  readonly subject: string
  readonly body: string
  readonly logKey: string
}

export async function engagementSuggestionsAction(): Promise<readonly EngagementSuggestion[]> {
  const ctx = await requireTenantContext(OWNER)
  const [audience, contentSnap, logSnap] = await Promise.all([
    loadAudience(ctx.studioId),
    col(ctx.studioId).get(),
    adminDb().collection(`studios/${ctx.studioId}/engagementLog`).get(),
  ])
  const content = contentSnap.docs.map((d) => d.data() as { category: string; subject: string; body: string })
  const sent = new Map<string, number>()
  for (const d of logSnap.docs) sent.set(d.id, Number((d.data() as { sentAt?: number }).sentAt ?? 0))
  const has = (id: string, k: string) => sent.has(`${id}_${k}`)
  const within = (id: string, k: string, ms: number) => (sent.get(`${id}_${k}`) ?? 0) > Date.now() - ms
  const draft = (t: SugType) => {
    const c = content.find((x) => x.category === CAT_OF[t])
    return c ? { subject: c.subject, body: c.body } : FALLBACK[t]
  }

  const now = Date.now()
  const year = new Date().getFullYear()
  const mmdd = `${String(new Date().getMonth() + 1).padStart(2, '0')}-${String(new Date().getDate()).padStart(2, '0')}`
  const out: EngagementSuggestion[] = []
  const make = (t: SugType, m: { id: unknown; fullName: string }, reason: string, logKey: string) => {
    const d = draft(t)
    out.push({ id: `${t}:${m.id as string}`, type: t, typeLabel: SUG_LABEL[t]!, memberId: m.id as string, memberName: m.fullName, reason, subject: d.subject, body: d.body, logKey })
  }

  // At most ONE suggestion per member per view — priority order avoids over-messaging.
  for (const m of audience.active) {
    const id = m.id as string
    const cats = audience.catByMember.get(id)
    const recency = lastActivityAt(m.stats) ?? Number(m.joinedAt)
    const daysSince = (now - recency) / DAY
    const daysMember = (now - Number(m.joinedAt)) / DAY
    const birth = (m.birthDate as string | null) ?? null
    const attended = m.stats.totalAttended ?? 0
    const milestone = [...MILESTONES].reverse().find((n) => attended >= n && !has(id, `milestone_${n}`))

    if (birth && birth.slice(5) === mmdd && !has(id, `birthday_${year}`)) make('birthday', m, 'Bugün doğum günü', `birthday_${year}`)
    else if (milestone) make('milestone', m, `${milestone}. dersini tamamladı 🎯`, `milestone_${milestone}`)
    else if (audience.recentCancelIds.has(id) && !within(id, 'cancellation', 7 * DAY)) make('cancellation', m, 'Yakın zamanda ders iptal etti', 'cancellation')
    else if ((cats?.size ?? 0) > 0 && daysSince >= 14 && !within(id, 'missed', 14 * DAY)) make('missed', m, `${Math.round(daysSince)} gündür gelmiyor`, 'missed')
    else if (daysMember <= 14 && !has(id, 'welcome')) make('welcome', m, `${Math.round(daysMember)} gün önce katıldı`, 'welcome')
  }
  return out
}

// ── The curated starter content (owner edits freely from here). ──
const DEFAULT_CONTENT: readonly { category: EngagementCategory; title: string; subject: string; body: string }[] = [
  // Motivasyon
  { category: 'motivation', title: 'Pazartesi motivasyonu', subject: 'Yeni bir hafta, yeni bir sen ✨', body: 'Bu hafta kendine bir söz ver: sadece bir ders bile olsa, gel. Küçük adımlar büyük değişimler yaratır. Seni matta bekliyoruz!' },
  { category: 'motivation', title: 'Kendine iyi bak', subject: 'Bugün kendine 1 saat ayır 💛', body: 'Koşuşturma içinde en çok ihmal ettiğimiz şey kendimiz oluyor. Bugün o 1 saati kendine ayır — bedenin de zihnin de teşekkür edecek.' },
  { category: 'motivation', title: 'Süreklilik', subject: 'Mükemmel değil, sürekli ol', body: 'En iyi antrenman, yaptığın antrenmandır. Bu hafta bir dersini bile kaçırma; süreklilik, motivasyondan güçlüdür.' },
  { category: 'motivation', title: 'Küçük adımlar', subject: 'Bugün sadece başla 🌱', body: 'Hedefin büyük olabilir ama tek ihtiyacın olan şey bugünkü adım. Gerisi kendiliğinden gelir. Hadi, seni derste görelim.' },
  { category: 'motivation', title: 'Güçlü hisset', subject: 'Bedenine iyi bak, o sana bakar', body: 'Hareket etmek sadece fiziksel değil; zihnini de dinlendirir, enerjini yükseltir. Bu hafta kendine bu iyiliği yap.' },
  { category: 'motivation', title: 'Hafta sonu hatırlatma', subject: 'Hafta sonu senin zamanın 🧘‍♀️', body: 'Yoğun bir haftanın ardından kendine güzel bir ders hediye et. Bedenini gevşet, zihnini boşalt — pazartesiye daha güçlü başla.' },
  // Seni özledik
  { category: 'missed', title: 'Seni özledik', subject: 'Seni bir süredir göremedik 🌸', body: 'Merhaba! Bir süredir yoktun, iyi olduğuna emin olmak istedik. Her şey yolunda mı? Sana uygun bir gün ayarlayalım, kapımız hep açık.' },
  { category: 'missed', title: 'Geri dön', subject: 'Yerin seni bekliyor', body: 'Ara vermek çok normal — ama geri dönmek için en iyi zaman bugün. İstersen sana özel bir başlangıç planı çıkaralım. Bir mesaj kadar uzaktayız.' },
  // Hoş geldin
  { category: 'welcome', title: 'Hoş geldin', subject: 'Aramıza hoş geldin! 🤗', body: 'Seni aramızda görmek çok güzel. İlk günlerinde aklına takılan her şeyi bize sorabilirsin — bu yolculukta yanındayız. Hadi başlayalım!' },
  { category: 'welcome', title: 'İlk ders daveti', subject: 'İlk dersini planlayalım', body: 'Başlamak için en güzel an şimdi. Sana uygun bir gün ve saat seçelim, gerisini birlikte hallederiz. Seni bekliyoruz!' },
  // İptal geri bildirimi
  { category: 'cancellation', title: 'İptal sonrası', subject: 'Dersini kaçırdığına üzüldük', body: 'Dersini iptal ettiğini gördük — umarız her şey yolundadır. Bir aksilik mi oldu, yoksa saat mi uymadı? Sana daha uygun bir zaman bulmak isteriz.' },
  // Kilometre taşı
  { category: 'milestone', title: 'Tebrikler (kilometre taşı)', subject: 'Harikasın! 🎉', body: 'Emeğin ve düzenin gerçekten takdire değer. Bu istikrar seni her gün daha güçlü yapıyor. Seninle gurur duyuyoruz — böyle devam!' },
  { category: 'milestone', title: 'Disiplin ödülü', subject: 'Bu disiplin ödülü hak ediyor 💪', body: 'Gösterdiğin süreklilik gerçekten özel. Küçük bir sürprizimiz var — bir sonraki gelişinde resepsiyona uğramayı unutma!' },
  // Kampanya
  { category: 'campaign', title: 'Yaz kampanyası', subject: 'Yaz fırsatı başladı ☀️', body: 'Bu aya özel paketlerde avantajlı fiyatlar seni bekliyor. Detaylar için resepsiyona uğra ya da bize yaz — yerini erkenden ayırt.' },
  { category: 'campaign', title: 'Arkadaşını getir', subject: 'Arkadaşınla gel, ikiniz de kazanın 👯‍♀️', body: 'Bir arkadaşını stüdyoya getir, ikinize de özel sürprizimiz olsun. Birlikte hareket etmek çok daha keyifli!' },
  // Doğum günü
  { category: 'birthday', title: 'Doğum günü kutlaması', subject: 'İyi ki doğdun! 🎉', body: 'Bugün senin günün! Tüm ekibimizle doğum gününü kutluyoruz. Sağlıkla, enerjiyle ve bol hareketle dolu bir yaş olsun. 🎂' },
]
