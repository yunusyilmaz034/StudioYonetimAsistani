'use server'

import { FirestoreEntitlementRepository, FirestoreMemberRepository, lastActivityAt } from '@studio/core'
import { z } from 'zod'

import { requireTenantContext } from '../auth'
import { adminDb } from '../firebase-admin'

// ── "STÜDYODAN" ENGAGEMENT (v1.27) — the living content library + audience segments that turn the app
//    into a daily bond, not just a booking screen. Content is owner-editable config
//    (studios/{sid}/engagementContent). Sending reuses the notification pipeline (notify → inbox +
//    push, preference-aware) via the `engagement_broadcast` passthrough template. ──

const OWNER = ['owner', 'platform_admin'] as const
const OPS = ['owner', 'receptionist', 'platform_admin'] as const

export type EngagementCategory = 'motivation' | 'birthday' | 'missed' | 'campaign' | 'custom'
export type SegmentKey = 'all' | 'fitness' | 'pilates' | 'dormant' | 'regular' | 'new' | 'birthday'

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
      category: z.enum(['motivation', 'birthday', 'missed', 'campaign', 'custom']),
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
  const [members, ents] = await Promise.all([
    new FirestoreMemberRepository(adminDb()).list(ctx),
    new FirestoreEntitlementRepository(adminDb()).listActive(ctx),
  ])
  const active = members.filter((m) => m.status === 'active')
  const catByMember = new Map<string, Set<string>>()
  for (const e of ents) {
    const set = catByMember.get(e.memberId as string) ?? new Set<string>()
    set.add(e.productSnapshot.category)
    catByMember.set(e.memberId as string, set)
  }
  return { active, catByMember }
}

const NOW = () => Date.now()

function membersInSegment(
  segment: SegmentKey,
  active: Awaited<ReturnType<typeof loadAudience>>['active'],
  catByMember: Map<string, Set<string>>,
): string[] {
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
        case 'dormant':
          return (cats?.size ?? 0) > 0 && daysSince >= 14 // aktif paketi var ama 2+ haftadır gelmiyor
        case 'regular':
          return daysSince <= 7
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
  const { active, catByMember } = await loadAudience(studioId)
  return membersInSegment(segment, active, catByMember)
}

const SEGMENT_LABEL: Record<SegmentKey, string> = {
  all: 'Tüm üyeler',
  fitness: 'Fitness üyeleri',
  pilates: 'Pilates üyeleri',
  dormant: 'Soğuyan üyeler (2+ hafta)',
  regular: 'Düzenli gelenler',
  new: 'Yeni üyeler (30 gün)',
  birthday: 'Bugün doğum günü',
}

// Live counts for the composer — so the owner sees "Fitness üyeleri (23)" before sending.
export async function segmentCountsAction(): Promise<readonly SegmentInfo[]> {
  const ctx = await requireTenantContext(OPS)
  const { active, catByMember } = await loadAudience(ctx.studioId)
  return (Object.keys(SEGMENT_LABEL) as SegmentKey[]).map((key) => ({
    key,
    label: SEGMENT_LABEL[key],
    count: membersInSegment(key, active, catByMember).length,
  }))
}

// ── The curated starter content (owner edits freely from here). ──
const DEFAULT_CONTENT: readonly { category: EngagementCategory; title: string; subject: string; body: string }[] = [
  { category: 'motivation', title: 'Pazartesi motivasyonu', subject: 'Yeni bir hafta, yeni bir sen ✨', body: 'Bu hafta kendine bir söz ver: sadece bir ders bile olsa, gel. Küçük adımlar büyük değişimler yaratır. Seni matta bekliyoruz!' },
  { category: 'motivation', title: 'Kendine iyi bak', subject: 'Bugün kendine 1 saat ayır 💛', body: 'Koşuşturma içinde en çok ihmal ettiğimiz şey kendimiz oluyor. Bugün o 1 saati kendine ayır — bedenin de zihnin de teşekkür edecek.' },
  { category: 'motivation', title: 'Süreklilik', subject: 'Mükemmel değil, sürekli ol', body: 'En iyi antrenman, yaptığın antrenmandır. Bu hafta bir dersini bile kaçırma; süreklilik, motivasyondan güçlüdür.' },
  { category: 'missed', title: 'Seni özledik (fitness)', subject: 'Seni bir süredir göremedik 🌸', body: 'Merhaba! Bir süredir salonda yoktun, iyi olduğuna emin olmak istedik. Her şey yolunda mı? Sana uygun bir gün ayarlayalım, kapımız hep açık.' },
  { category: 'missed', title: 'Geri dön', subject: 'Yerin seni bekliyor', body: 'Ara vermek çok normal — ama geri dönmek için en iyi zaman bugün. İstersen sana özel bir başlangıç planı çıkaralım. Bir mesaj kadar uzaktayız.' },
  { category: 'birthday', title: 'Doğum günü kutlaması', subject: 'İyi ki doğdun! 🎉', body: 'Bugün senin günün! Tüm ekibimizle doğum gününü kutluyoruz. Sağlıkla, enerjiyle ve bol hareketle dolu bir yaş olsun. 🎂' },
  { category: 'campaign', title: 'Yaz kampanyası', subject: 'Yaz fırsatı başladı ☀️', body: 'Bu aya özel paketlerde avantajlı fiyatlar seni bekliyor. Detaylar için resepsiyona uğra ya da bize yaz — yerini erkenden ayırt.' },
  { category: 'campaign', title: 'Arkadaşını getir', subject: 'Arkadaşınla gel, ikiniz de kazanın 👯‍♀️', body: 'Bir arkadaşını stüdyoya getir, ikinize de özel sürprizimiz olsun. Birlikte hareket etmek çok daha keyifli!' },
]
