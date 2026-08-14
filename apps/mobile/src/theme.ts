// The member app's design system — the premium language of the owner's UI Board (2026-08-14).
//
// ── WHAT CHANGED, AND WHAT DID NOT ──────────────────────────────────────────────────────────
//
// This replaces "Stüdyo Editoryal" (2026-08-06), which put the marketing site's Georgia and bone
// paper into the app so the two would stop looking like different businesses. That reasoning was
// sound and is being overruled deliberately, not forgotten: the owner's UI Board asks for a modern
// sans and a card-based surface language, and the Board is the newer decision. Recorded here so
// nobody re-derives the serif six months from now and thinks they are fixing a regression.
//
// The PALETTE barely moves — burgundy #7B1E2E against #7A1F3D, warm ground #F7F4EF against #F7F2EA.
// What actually changes is the TYPE (serif → Poppins) and the SURFACE (hairline rules → soft
// layered cards). Knowing that is what keeps this a re-skin rather than a rewrite.
//
// ── WHY THE OLD TOKEN NAMES SURVIVE ─────────────────────────────────────────────────────────
//
// Every screen reads `p.bg`, `p.text`, `p.accent`, `p.hairline`. Renaming them all at once means one
// commit where nothing compiles and every screen must be touched before anything can be seen. So the
// semantic names below are the contract going forward, and the old names remain as ALIASES pointing
// at the same values. A screen can migrate on its own day, and the app is never half-broken.
import { Platform, useColorScheme, type TextStyle, type ViewStyle } from 'react-native'

// ── SEMANTIC TOKENS ─────────────────────────────────────────────────────────────────────────
const light = {
  // Surfaces, lightest to most lifted.
  background: '#F7F4EF', // warm off-white — the ground everything sits on
  surface: '#FFFDFC', // a card, barely lifted
  surfaceElevated: '#FFFFFF', // a sheet or modal, genuinely above the page
  surfaceMuted: '#F0EBE3', // a well: chips, inactive segments, skeletons

  // Brand.
  primary: '#7B1E2E',
  primaryPressed: '#5E1522',
  primarySoft: '#7B1E2E12', // a wash for selected chips and soft fills
  onPrimary: '#FFFFFF',
  accent: '#88374A', // the lighter burgundy, for secondary emphasis

  // Text, strongest to quietest. Three levels only — a fourth always becomes decoration.
  textPrimary: '#1F1F1F', // charcoal
  textSecondary: '#5C5651',
  textMuted: '#9A938C',

  border: '#E8E1D8',

  // Status. Deliberately restrained: green is a confirmation, not a celebration.
  success: '#5F8052',
  successSoft: '#5F805214',
  warning: '#B4690E',
  warningSoft: '#B4690E14',
  error: '#9C2B2B',
  errorSoft: '#9C2B2B14',

  // Kept for the few surfaces that still want a filled band (the QR moment, campaign artwork).
  gradFrom: '#7B1E2E',
  gradTo: '#4E1226',
  onGrad: '#FFFFFF',
  onGradMuted: '#F3D9E2',
} as const

const dark = {
  background: '#151312',
  surface: '#1E1B1A',
  surfaceElevated: '#262220',
  surfaceMuted: '#2C2725',

  primary: '#D08496',
  primaryPressed: '#B5697C',
  primarySoft: '#D084961F',
  onPrimary: '#1A1113',
  accent: '#C08292',

  textPrimary: '#F5F1ED',
  textSecondary: '#B3ABA4',
  textMuted: '#7E766F',

  border: '#37312E',

  success: '#8FA97F',
  successSoft: '#8FA97F1F',
  warning: '#E0A45B',
  warningSoft: '#E0A45B1F',
  error: '#E08585',
  errorSoft: '#E085851F',

  gradFrom: '#7B1E2E',
  gradTo: '#2A0A16',
  onGrad: '#FFFFFF',
  onGradMuted: '#E9C7D2',
} as const

/**
 * The contract is the SET OF NAMES, not the values — `as const` would otherwise make the dark
 * palette fail to satisfy the light one ("#151312" is not "#F7F4EF").
 *
 * The previous version of this type had exactly that bug, and its own comment admitted the app had
 * been failing typecheck since the dark theme landed because `apps/mobile` is not in `pnpm check`.
 * Written as a mapped type so it cannot happen again.
 */
type Tokens = { readonly [K in keyof typeof light]: string }

/** The old names, still read by every screen that has not migrated yet. One value, two doors. */
function withLegacyAliases(t: Tokens) {
  return {
    ...t,
    bg: t.background,
    bgElevated: t.surfaceElevated,
    text: t.textPrimary,
    textFaint: t.textMuted,
    hairline: t.border,
    accentSoft: t.primarySoft,
    accentDeep: t.primaryPressed,
    accentText: t.onPrimary,
    good: t.success,
    goodSoft: t.successSoft,
    warn: t.warning,
    warnSoft: t.warningSoft,
    danger: t.error,
    dangerSoft: t.errorSoft,
    gold: '#B98A4B',
  }
}

export type Palette = ReturnType<typeof withLegacyAliases>

export function usePalette(): Palette {
  return withLegacyAliases(useColorScheme() === 'dark' ? dark : light)
}

// ── SPACING — 8pt based ─────────────────────────────────────────────────────────────────────
//
// `space(n)` stays 4·n so no existing call site changes meaning; the SCALE below is the vocabulary
// to reach for. Screen gutter is 20 (5) on phones — 24 (6) felt generous on a 375pt screen, which is
// still the width that decides whether a layout is honest.
export const space = (n: number) => n * 4
export const gutter = space(5)

// ── RADIUS — soft, never a lozenge ──────────────────────────────────────────────────────────
export const radius = { sm: 10, md: 16, lg: 20, xl: 24, pill: 999 }

/**
 * Elevation. Layered and light: a card is lifted, not floating.
 *
 * Level 3 exists for sheets and modals only. If a surface needs level 3 to read against its ground,
 * the ground is wrong, not the shadow.
 */
export const shadow = (level: 1 | 2 | 3 = 1): ViewStyle => {
  const map = {
    1: { radius: 10, y: 2, opacity: 0.05, elevation: 1 },
    2: { radius: 20, y: 8, opacity: 0.08, elevation: 4 },
    3: { radius: 32, y: 16, opacity: 0.14, elevation: 12 },
  } as const
  const s = map[level]
  return {
    shadowColor: '#2A1015',
    shadowOffset: { width: 0, height: s.y },
    shadowOpacity: s.opacity,
    shadowRadius: s.radius,
    elevation: s.elevation,
  }
}

// ── TYPOGRAPHY ──────────────────────────────────────────────────────────────────────────────
//
// Poppins, from the UI Board. Loaded in `app/_layout.tsx`; until it is ready the app holds the
// splash, because a first paint in the system font followed by a reflow is the cheapest possible
// way to look unfinished.
//
// Weight discipline is where the premium actually lives. Three weights, and Bold is reserved for
// figures and buttons — a screen where everything is bold has no hierarchy, it has noise.
export const font = {
  regular: 'Poppins_400Regular',
  medium: 'Poppins_500Medium',
  semibold: 'Poppins_600SemiBold',
  bold: 'Poppins_700Bold',
} as const

/** Android renders Poppins a touch heavier; nudged so the two platforms read the same weight. */
const tight = Platform.select({ ios: -0.4, android: -0.2, default: -0.4 }) as number

export const typo = {
  display: { fontFamily: font.semibold, fontSize: 30, lineHeight: 38, letterSpacing: tight } as TextStyle,
  h1: { fontFamily: font.semibold, fontSize: 23, lineHeight: 30, letterSpacing: tight } as TextStyle,
  h2: { fontFamily: font.semibold, fontSize: 18, lineHeight: 24, letterSpacing: -0.2 } as TextStyle,
  h3: { fontFamily: font.medium, fontSize: 15.5, lineHeight: 21 } as TextStyle,

  bodyLarge: { fontFamily: font.regular, fontSize: 15.5, lineHeight: 23 } as TextStyle,
  body: { fontFamily: font.regular, fontSize: 14, lineHeight: 21 } as TextStyle,
  caption: { fontFamily: font.regular, fontSize: 12.5, lineHeight: 17 } as TextStyle,

  /** Section labels: small, spaced, quiet. They organise without competing. */
  label: { fontFamily: font.semibold, fontSize: 10.5, letterSpacing: 1.2 } as TextStyle,
  button: { fontFamily: font.semibold, fontSize: 14.5, letterSpacing: 0.1 } as TextStyle,

  /** Figures a member reads as facts about herself. Tabular, so a column of them lines up. */
  num: { fontFamily: font.semibold, fontSize: 34, lineHeight: 40, letterSpacing: -1, fontVariant: ['tabular-nums'] } as TextStyle,
  numSm: { fontFamily: font.semibold, fontSize: 19, lineHeight: 24, letterSpacing: -0.2, fontVariant: ['tabular-nums'] } as TextStyle,

  // ── Legacy roles, still referenced by unmigrated screens ──
  eyebrow: { fontFamily: font.semibold, fontSize: 10.5, letterSpacing: 1.2 } as TextStyle,
  bodyStrong: { fontFamily: font.medium, fontSize: 14.5, lineHeight: 21 } as TextStyle,
  voice: { fontFamily: font.regular, fontSize: 15.5, lineHeight: 24 } as TextStyle,
}

/**
 * Uppercase, in Turkish.
 *
 * The two letters the platform gets wrong, both ways round: dotted i uppercases to İ (not I), and
 * dotless ı uppercases to I (not İ). Applied to the STRING, never as `textTransform` on the box —
 * the platform transform is locale-blind and turned "Üyeliğin" into "ÜYELIĞIN" across the app.
 */
export function trUpper(text: string): string {
  return text.replace(/i/g, 'İ').replace(/ı/g, 'I').toUpperCase()
}
