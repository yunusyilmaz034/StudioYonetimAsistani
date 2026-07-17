// ── Studio theme (PF-12), presets-first. ─────────────────────────────────────────────────────
//
// The owner picks a THEME from a curated set, not a free colour wheel: a hand-tuned palette keeps the
// premium look and the contrast we designed, where an arbitrary hex would quietly break both. Each
// preset only swaps the ONE confident accent hue (+ its hover/soft/ring); the warm neutral base is
// fixed on purpose. Font size and a small family choice are the other two safe dials. Granular
// per-surface control and a dark theme are deliberately deferred (Phase 2).
//
// This is DATA read on the server and injected as `:root` custom properties over globals.css. Nothing
// here is a literal in a component.

export interface ThemePreset {
  readonly id: string
  readonly name: string
  readonly primary: string
  readonly primaryHover: string
  readonly primarySoft: string
  readonly primaryForeground: string
}

// The default (id 'murdum') is exactly the shipped palette — selecting it changes nothing.
export const THEME_PRESETS: readonly ThemePreset[] = [
  { id: 'murdum', name: 'Mürdüm (Varsayılan)', primary: '#a22d60', primaryHover: '#85234e', primarySoft: '#f3e2e9', primaryForeground: '#fcf4f1' },
  { id: 'gul', name: 'Gül', primary: '#c0396b', primaryHover: '#9e2b55', primarySoft: '#f7e4ec', primaryForeground: '#fff5f8' },
  { id: 'zumrut', name: 'Zümrüt', primary: '#2f7d5b', primaryHover: '#245f46', primarySoft: '#e0efe8', primaryForeground: '#f2fbf6' },
  { id: 'okyanus', name: 'Okyanus', primary: '#2f6f8f', primaryHover: '#245672', primarySoft: '#e1eef4', primaryForeground: '#f2fafd' },
  { id: 'amber', name: 'Amber', primary: '#b0722a', primaryHover: '#8f5c20', primarySoft: '#f4e9d7', primaryForeground: '#fff8ee' },
]

export type FontScale = 'sm' | 'md' | 'lg'
export const FONT_SCALES: Readonly<Record<FontScale, { label: string; rootPx: string }>> = {
  sm: { label: 'Küçük', rootPx: '15px' },
  md: { label: 'Orta (Varsayılan)', rootPx: '16px' },
  lg: { label: 'Büyük', rootPx: '17.5px' },
}

export type FontFamilyId = 'default' | 'system' | 'rounded'
// All options are system-available — no external font is fetched (CSP-safe). Richer bundled faces are a
// later addition; the model is ready for them.
export const FONT_FAMILIES: Readonly<Record<FontFamilyId, { label: string; stack: string | null }>> = {
  default: { label: 'Varsayılan', stack: null },
  system: { label: 'Sistem', stack: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' },
  rounded: { label: 'Yuvarlak', stack: '"Trebuchet MS", "Segoe UI", system-ui, sans-serif' },
}

// Per-class-type colours (PF-12 phase 2) — what tints a session on the calendar. Overridable one by one;
// null = the shipped default. The `-soft` cell tint is DERIVED, so a chosen hue always sits right on both
// light and dark grounds. (Sidebar / agenda-ground overrides can join this map later the same way.)
export const CATEGORY_KEYS = ['pilates', 'fitness', 'private'] as const
export type CategoryKey = (typeof CATEGORY_KEYS)[number]
export const CATEGORY_LABEL: Readonly<Record<CategoryKey, string>> = {
  pilates: 'Pilates',
  fitness: 'Fitness',
  private: 'Özel Ders (PT)',
}
// The shipped defaults, so a picker can show/reset to them.
export const CATEGORY_DEFAULT: Readonly<Record<CategoryKey, string>> = {
  pilates: '#955b8b',
  fitness: '#4e7c5a',
  private: '#b5842f',
}

// Per-surface colours (PF-12 phase 2) — the sidebar background and the calendar (agenda) cell ground.
// Each maps to a dedicated CSS var; null = the shipped default. Same override mechanism as categories.
export const SURFACE_KEYS = ['sidebar', 'agenda'] as const
export type SurfaceKey = (typeof SURFACE_KEYS)[number]
export const SURFACE_VAR: Readonly<Record<SurfaceKey, string>> = { sidebar: '--sidebar', agenda: '--calendar-cell' }
export const SURFACE_LABEL: Readonly<Record<SurfaceKey, string>> = { sidebar: 'Kenar çubuğu (sidebar)', agenda: 'Ajanda hücresi' }
export const SURFACE_DEFAULT: Readonly<Record<SurfaceKey, string>> = { sidebar: '#fcf8f7', agenda: '#ece1dd' }

export interface StudioTheme {
  readonly presetId: string
  readonly fontScale: FontScale
  readonly fontFamily: FontFamilyId
  readonly categories: Readonly<Record<CategoryKey, string | null>>
  readonly surfaces: Readonly<Record<SurfaceKey, string | null>>
}

export const DEFAULT_THEME: StudioTheme = {
  presetId: 'murdum',
  fontScale: 'md',
  fontFamily: 'default',
  categories: { pilates: null, fitness: null, private: null },
  surfaces: { sidebar: null, agenda: null },
}

const HEX = /^#[0-9a-fA-F]{6}$/
const hexOrNull = (v: unknown): string | null => (typeof v === 'string' && HEX.test(v) ? v : null)

export function normalizeTheme(raw: Readonly<Record<string, unknown>> | null | undefined): StudioTheme {
  const r = (raw ?? {}) as Record<string, unknown>
  const presetId = THEME_PRESETS.some((p) => p.id === r.presetId) ? (r.presetId as string) : DEFAULT_THEME.presetId
  const fontScale =
    typeof r.fontScale === 'string' && r.fontScale in FONT_SCALES ? (r.fontScale as FontScale) : DEFAULT_THEME.fontScale
  const fontFamily =
    typeof r.fontFamily === 'string' && r.fontFamily in FONT_FAMILIES ? (r.fontFamily as FontFamilyId) : DEFAULT_THEME.fontFamily
  const rc = (r.categories ?? {}) as Partial<Record<CategoryKey, unknown>>
  const categories = {
    pilates: hexOrNull(rc.pilates),
    fitness: hexOrNull(rc.fitness),
    private: hexOrNull(rc.private),
  }
  const rs = (r.surfaces ?? {}) as Partial<Record<SurfaceKey, unknown>>
  const surfaces = { sidebar: hexOrNull(rs.sidebar), agenda: hexOrNull(rs.agenda) }
  return { presetId, fontScale, fontFamily, categories, surfaces }
}

// The `:root`/`html` overrides for a theme, as a CSS string. Injected AFTER globals.css so it wins.
export function themeCss(theme: StudioTheme): string {
  const preset = THEME_PRESETS.find((p) => p.id === theme.presetId) ?? THEME_PRESETS[0]!
  const family = FONT_FAMILIES[theme.fontFamily].stack
  const rootPx = FONT_SCALES[theme.fontScale].rootPx
  const rootVars = [
    `--primary:${preset.primary}`,
    `--primary-hover:${preset.primaryHover}`,
    `--primary-soft:${preset.primarySoft}`,
    `--primary-foreground:${preset.primaryForeground}`,
    `--ring:${preset.primary}`,
    ...(family ? [`--font-sans:${family}`] : []),
  ].join(';')
  // Per-category overrides: the hue + a DERIVED soft cell tint. Emitted on BOTH :root and the dark
  // selector so the owner's choice wins in either theme (the dark block sets its own --cat-* otherwise).
  const catVars = CATEGORY_KEYS.flatMap((k) => {
    const v = theme.categories[k]
    return v ? [`--cat-${k}:${v}`, `--cat-${k}-soft:color-mix(in oklch, ${v} 14%, var(--background))`] : []
  }).join(';')
  const catRule = catVars ? `:root{${catVars}}:root[data-theme='dark']{${catVars}}` : ''
  // Per-surface overrides (sidebar, agenda cell) → their dedicated vars, both themes.
  const surfVars = SURFACE_KEYS.flatMap((k) => {
    const v = theme.surfaces[k]
    return v ? [`${SURFACE_VAR[k]}:${v}`] : []
  }).join(';')
  const surfRule = surfVars ? `:root{${surfVars}}:root[data-theme='dark']{${surfVars}}` : ''
  return `:root{${rootVars}}${catRule}${surfRule}html{font-size:${rootPx}}`
}
