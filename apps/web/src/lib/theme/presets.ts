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

export interface StudioTheme {
  readonly presetId: string
  readonly fontScale: FontScale
  readonly fontFamily: FontFamilyId
}

export const DEFAULT_THEME: StudioTheme = { presetId: 'murdum', fontScale: 'md', fontFamily: 'default' }

export function normalizeTheme(raw: Partial<StudioTheme> | null | undefined): StudioTheme {
  const presetId = THEME_PRESETS.some((p) => p.id === raw?.presetId) ? raw!.presetId! : DEFAULT_THEME.presetId
  const fontScale = raw?.fontScale && raw.fontScale in FONT_SCALES ? raw.fontScale : DEFAULT_THEME.fontScale
  const fontFamily = raw?.fontFamily && raw.fontFamily in FONT_FAMILIES ? raw.fontFamily : DEFAULT_THEME.fontFamily
  return { presetId, fontScale, fontFamily }
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
  return `:root{${rootVars}}html{font-size:${rootPx}}`
}
