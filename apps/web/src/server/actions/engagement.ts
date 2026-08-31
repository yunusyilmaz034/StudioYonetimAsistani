'use server'

import { isDemoMode } from '../demo-mode'
import { maskName } from '@/lib/demo-mask'
import { FirestoreEntitlementRepository, FirestoreMemberRepository, FirestoreReservationRepository, instant, lastActivityAt } from '@studio/core'
import { z } from 'zod'

import { SEGMENT_KEYS, SEGMENT_LABEL, type SegmentKey } from '@/lib/segments'

import { requireTenantContext } from '../auth'
import { adminDb } from '../firebase-admin'

// ── "STÜDYODAN" ENGAGEMENT (v1.27) — the living content library + audience segments that turn the app
//    into a daily bond, not just a booking screen. Content is owner-editable config
//    (studios/{sid}/engagementContent). Sending reuses the notification pipeline (notify → inbox +
//    push, preference-aware) via the `engagement_broadcast` passthrough template. ──

const OWNER = ['owner', 'platform_admin'] as const
const OPS = ['owner', 'receptionist', 'platform_admin'] as const

export type EngagementCategory = 'motivation' | 'birthday' | 'missed' | 'welcome' | 'cancellation' | 'milestone' | 'campaign' | 'custom'

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
        // "Aktif üye" = en az bir CANLI paketi olan. `catByMember` yalnızca aktif entitlement'lardan
        // kurulduğu için ölçüt bu: paketi bitmiş ya da iptal olmuş üye burada yer almaz.
        //
        // Duyuru gönderirken istenen kitle çoğunlukla budur: parası hâlâ stüdyoda olan kişi. "Tüm
        // üyeler" ise yıllar içinde birikmiş herkesi kapsar ve içinde bir daha gelmeyecekler de vardır.
        case 'active':
          return (cats?.size ?? 0) > 0
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

// ── ÜYE GRUPLARI (owner, 2026-08-31) ──────────────────────────────────────────────────────────
//
// The segments above are COMPUTED: "Fitness paketi olanlar" is a question re-asked every time it is
// shown, and its answer changes as the studio changes. A group is the opposite — a list the owner
// picked by hand ("Salı 10:00 grubu", "hamileler", "referans getirenler"). No rule describes it, so
// nothing can recompute it, and it must be stored.
//
// The distinction is deliberately visible in the UI, because it decides whether a stale audience is a
// bug or a fact: a segment that has gone out of date is broken; a group that no longer matches is
// simply a list the owner has not updated yet.
//
// Config data, like the content library and the notification templates — not event-sourced. A group is
// a saved query, not a business event: forgetting how the owner grouped her members in March costs
// nothing, and the membership itself lives in `/members` regardless.

const groupCol = (studioId: string) => adminDb().collection('studios').doc(studioId).collection('engagementGroups')

export interface EngagementGroup {
  readonly id: string
  readonly name: string
  readonly memberIds: readonly string[]
  /** Kaçı hâlâ gönderilebilir durumda — silinmiş/pasif üyeler düşülmüş hâli. */
  readonly liveCount: number
  readonly updatedAt: number
}

export async function listEngagementGroupsAction(): Promise<readonly EngagementGroup[]> {
  const ctx = await requireTenantContext(OPS)
  const [snap, members] = await Promise.all([
    groupCol(ctx.studioId).get(),
    new FirestoreMemberRepository(adminDb()).list({ studioId: ctx.studioId } as never),
  ])
  const canli = new Set(members.filter((m) => m.status === 'active').map((m) => m.id as string))
  return snap.docs
    .map((d) => {
      const x = d.data()
      const memberIds = (Array.isArray(x.memberIds) ? x.memberIds : []).map(String)
      return {
        id: d.id,
        name: String(x.name ?? ''),
        memberIds,
        // A member who left is silently dropped from the SEND, so the count on screen has to drop
        // with her. A group that says 12 and reaches 9 is the kind of number that stops being read.
        liveCount: memberIds.filter((id) => canli.has(id)).length,
        updatedAt: Number(x.updatedAt ?? 0),
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'tr'))
}

export async function upsertEngagementGroupAction(input: unknown) {
  const p = z
    .object({
      id: z.string().optional(),
      name: z.string().trim().min(1).max(60),
      // 2000 is the same ceiling `sendEngagementAction` accepts — a group that could not be sent to
      // is not a group worth saving.
      memberIds: z.array(z.string().min(1)).min(1).max(2000),
    })
    .parse(input)
  const ctx = await requireTenantContext(OWNER)
  const ref = p.id ? groupCol(ctx.studioId).doc(p.id) : groupCol(ctx.studioId).doc()
  // Aynı üye iki kez seçilirse iki mesaj gitmesin.
  const memberIds = [...new Set(p.memberIds)]
  await ref.set({ name: p.name, memberIds, updatedAt: Date.now() }, { merge: true })
  return { ok: true as const, value: { id: ref.id } }
}

export async function deleteEngagementGroupAction(input: unknown) {
  const p = z.object({ id: z.string().min(1) }).parse(input)
  const ctx = await requireTenantContext(OWNER)
  await groupCol(ctx.studioId).doc(p.id).delete()
  return { ok: true as const }
}

/**
 * The member ids an audience resolves to — the ONE function both the preview and the send call.
 *
 * They cannot be allowed to answer this differently. A preview that resolves its own audience is a
 * preview of a different send, and the whole point of showing it is that what it shows is what goes.
 */
export async function resolveAudience(
  studioId: string,
  audience: { segment?: SegmentKey | undefined; groupId?: string | undefined; memberIds?: readonly string[] | undefined },
): Promise<string[]> {
  if (audience.groupId) {
    const [snap, members] = await Promise.all([
      groupCol(studioId).doc(audience.groupId).get(),
      new FirestoreMemberRepository(adminDb()).list({ studioId } as never),
    ])
    if (!snap.exists) return []
    const canli = new Set(members.filter((m) => m.status === 'active').map((m) => m.id as string))
    const ids = (snap.get('memberIds') as unknown[] | undefined) ?? []
    // Ayrılan üye listede kalabilir — ona gönderilmez. Grubu elle temizlemek owner'ın işi değil.
    return ids.map(String).filter((id) => canli.has(id))
  }
  if (audience.segment) return resolveSegment(studioId, audience.segment)
  return [...(audience.memberIds ?? [])]
}

/**
 * WHO is in an audience — names, for the "(9) · kimler?" list.
 *
 * The counts alone were a dead end: the owner could see that nine members cancel constantly and had
 * no way to find out whether they were the nine she was thinking of. A number you cannot open is a
 * number you cannot act on.
 */
export async function audienceMembersAction(input: unknown): Promise<readonly { id: string; name: string }[]> {
  const p = z
    .object({
      segment: z.enum(SEGMENT_KEYS).optional(),
      groupId: z.string().min(1).optional(),
    })
    .parse(input)
  const ctx = await requireTenantContext(OPS)
  const [ids, members, demo] = await Promise.all([
    resolveAudience(ctx.studioId, p),
    new FirestoreMemberRepository(adminDb()).list(ctx),
    isDemoMode(),
  ])
  const byId = new Map(members.map((m) => [m.id as string, m]))
  return ids
    .map((id) => {
      const m = byId.get(id)
      return m ? { id, name: demo ? maskName(m.fullName, id) : m.fullName } : null
    })
    .filter((x): x is { id: string; name: string } => x !== null)
    .sort((a, b) => a.name.localeCompare(b.name, 'tr'))
}

/** The member picker's source: every active member, name only. */
export async function pickableMembersAction(): Promise<readonly { id: string; name: string }[]> {
  const ctx = await requireTenantContext(OPS)
  const [members, demo] = await Promise.all([new FirestoreMemberRepository(adminDb()).list(ctx), isDemoMode()])
  return members
    .filter((m) => m.status === 'active')
    .map((m) => ({ id: m.id as string, name: demo ? maskName(m.fullName, m.id as string) : m.fullName }))
    .sort((a, b) => a.name.localeCompare(b.name, 'tr'))
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
  // Demo modu — bu ekran, üye adını "23 gündür gelmiyor" bilgisiyle YAN YANA gösterir; maskesiz
  // haliyle bir ekran görüntüsünde kimin uzaklaştığı da açığa çıkar. İlk turda atlanmıştı ve bir
  // ekran görüntüsünde yakalandı: demo modu "bazı ekranlarda çalışır" olamaz.
  const demo = await isDemoMode()
  const make = (t: SugType, m: { id: unknown; fullName: string }, reason: string, logKey: string) => {
    const d = draft(t)
    out.push({ id: `${t}:${m.id as string}`, type: t, typeLabel: SUG_LABEL[t]!, memberId: m.id as string, memberName: demo ? maskName(m.fullName, m.id as string) : m.fullName, reason, subject: d.subject, body: d.body, logKey })
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
