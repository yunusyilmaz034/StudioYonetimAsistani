// AUDIENCE SEGMENTS — the key, the Turkish label, and the list of keys, in ONE place.
//
// This lives in `lib/` rather than beside the actions that use it for a reason that only shows up at
// deploy time: a `'use server'` file may export **async functions and nothing else**. A plain object
// or array exported from one compiles, typechecks and passes `pnpm check` — and then fails
// `next build` with "A 'use server' file can only export async functions, found object" (OR-15: the
// gate does not run `next build`). The label map and the key list are values, so they belong here;
// the functions that resolve and count a segment stay in `server/actions/engagement.ts`.
//
// Keeping the labels here also keeps them singular. They were retyped by hand in `notifications.ts`
// once and had already drifted before anyone noticed: `pt` and `cancellers` were missing there, so
// those two segments had been unsendable for as long as they had existed.

export type SegmentKey = 'all' | 'active' | 'fitness' | 'pilates' | 'pt' | 'dormant' | 'regular' | 'cancellers' | 'new' | 'birthday'

export const SEGMENT_LABEL: Record<SegmentKey, string> = {
  all: 'Tüm üyeler',
  active: 'Tüm aktif üyeler',
  fitness: 'Fitness paketi olanlar',
  pilates: 'Pilates paketi olanlar',
  pt: 'PT paketi olanlar',
  dormant: 'Uzun süredir gelmeyenler',
  regular: 'Disiplinli gelenler',
  cancellers: 'Sürekli iptal edenler',
  new: 'Yeni üyeler (30 gün)',
  birthday: 'Bugün doğum günü',
}

/** Every segment key, for validation. Derived, so a new segment cannot be forgotten in one place. */
export const SEGMENT_KEYS = Object.keys(SEGMENT_LABEL) as [SegmentKey, ...SegmentKey[]]

// ── KİTLE GRUPLARI (owner, 2026-08-31) ────────────────────────────────────────────────────────
//
// On rozet tek bir yığın hâlinde duruyordu ve owner'ın tarifi netti: *"burası çok karışık ya"*.
// Gruplayınca on rozet üç başlık olarak okunuyor — ve başlıklar süs değil, gerçek bir ayrımı
// taşıyor: biri KİM OLDUĞUNA, biri NE SATIN ALDIĞINA, biri NE YAPTIĞINA bakar. Farklı sorular,
// farklı raflar.
//
// Sıra da anlamlı: en sık kullanılan üstte. "Tüm aktif üyeler" günlük duyurunun kitlesidir.
export const SEGMENT_GROUPS: readonly { readonly label: string; readonly keys: readonly SegmentKey[] }[] = [
  { label: 'Herkes', keys: ['all', 'active'] },
  { label: 'Paketine göre', keys: ['fitness', 'pilates', 'pt'] },
  { label: 'Davranışına göre', keys: ['dormant', 'regular', 'cancellers', 'new', 'birthday'] },
]
