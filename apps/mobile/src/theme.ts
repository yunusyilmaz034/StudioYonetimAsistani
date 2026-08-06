// The member app's design language — "Stüdyo Editoryal" (owner-approved, 2026-08-06).
//
// The identity is the STUDIO'S OWN, not a new one: bone paper and mahogany ink are the marketing
// site's palette, and the display face is the site's Georgia. Until today the app and the website
// looked like two different businesses; a brand the studio already paid for was sitting unused.
//
// What changed from the previous language is MATERIAL, not structure: white cards floating on soft
// shadows became bone ground with hairline rules, and headings and figures moved to a serif. Screens
// keep their layouts (OR-6's discipline, applied to mobile) — see each screen for what stayed.
//
// The token NAMES are unchanged on purpose, so every screen picks up the new material without being
// rewritten and the app can never be half-migrated.
import { Platform, useColorScheme, type TextStyle, type ViewStyle } from 'react-native'

const light = {
  bg: '#F7F2EA', // bone — the paper everything sits on
  bgElevated: '#FFFDF9',
  surface: '#FFFDF9', // barely lifted off the page, not a floating white card
  surfaceMuted: '#EFE7DA',
  border: '#E4DACB',
  hairline: '#E4DACB', // a real 1px rule now, not a shadow substitute
  text: '#1A1614', // warm near-black; a cool grey would fight the paper
  textMuted: '#5B4F49',
  textFaint: '#9A8B80',
  accent: '#7A1F3D',
  accentSoft: '#7A1F3D14',
  accentDeep: '#5C1730',
  accentText: '#FFFFFF',
  gold: '#B98A4B',
  // Progress and "good" borrow the site's SECOND colour — a sage green nobody expects next to
  // mahogany, and the thing that keeps this palette off the shelf.
  good: '#77854E',
  goodSoft: '#77854E14',
  warn: '#B4690E',
  warnSoft: '#B4690E14',
  danger: '#9C2B2B',
  dangerSoft: '#9C2B2B14',
  // Kept for the few surfaces that still want a filled band (the QR moment, campaign artwork).
  gradFrom: '#7A1F3D',
  gradTo: '#4E1226',
  onGrad: '#FFFFFF',
  onGradMuted: '#F3D9E2',
} as const

const dark = {
  bg: '#17120F', // warm near-black — the same paper at night, not a blue-grey
  bgElevated: '#1F1917',
  surface: '#221B18',
  surfaceMuted: '#2B2320',
  border: '#3A2F29',
  hairline: '#3A2F29',
  text: '#F4EDE6',
  textMuted: '#B0A197',
  textFaint: '#7A6C63',
  accent: '#D8879C',
  accentSoft: '#D8879C1F',
  accentDeep: '#B65E79',
  accentText: '#1A1113',
  gold: '#D6A661',
  good: '#A3B173',
  goodSoft: '#A3B1731F',
  warn: '#E0A45B',
  warnSoft: '#E0A45B1F',
  danger: '#E08585',
  dangerSoft: '#E085851F',
  gradFrom: '#7A1F3D',
  gradTo: '#2A0A16',
  onGrad: '#FFFFFF',
  onGradMuted: '#E9C7D2',
} as const

// `as const` makes every value a literal type, so the dark palette would not satisfy `typeof light`
// ("#17120F" is not "#F7F2EA"). The contract is the SET OF NAMES — a palette must define every token
// and each one is a colour string. This has been failing typecheck since the dark theme landed; the
// mobile app is not in `pnpm check`, so nothing said so.
export type Palette = { readonly [K in keyof typeof light]: string }

export function usePalette(): Palette {
  return useColorScheme() === 'dark' ? dark : light
}

export const radius = { sm: 12, md: 18, lg: 24, xl: 30, pill: 999 }
export const space = (n: number) => n * 4

/**
 * The display face — the studio's own, from `pilatesfitnessbyisil.com`.
 *
 * Georgia ships with iOS. Android has no Georgia, and naming a missing family there silently falls
 * back to the sans — which is exactly the "looks fine in the simulator, wrong on half the phones"
 * failure OR-22 exists for. `'serif'` is Android's guaranteed alias (Noto Serif), close enough in
 * colour and weight to carry the same voice.
 */
export const serif = Platform.select({ ios: 'Georgia', android: 'serif', default: 'Georgia' }) as string

/**
 * Elevation, now almost silent.
 *
 * The old scale (opacity .06/.10/.16 at 12–34 px) was the visual signature of the previous language:
 * every card floated. Here separation comes from rules and space, so shadow is reserved for things
 * that genuinely sit ABOVE the page — a sheet, a modal, the QR panel. Level 1 is nearly invisible by
 * design; if a surface needs level 3 to read, it probably wants a rule instead.
 */
export const shadow = (level: 1 | 2 | 3 = 1): ViewStyle => {
  const map = {
    1: { radius: 8, y: 2, opacity: 0.03, elevation: 1 },
    2: { radius: 16, y: 6, opacity: 0.06, elevation: 3 },
    3: { radius: 30, y: 14, opacity: 0.12, elevation: 10 },
  } as const
  const s = map[level]
  return {
    shadowColor: '#3A1020',
    shadowOffset: { width: 0, height: s.y },
    shadowOpacity: s.opacity,
    shadowRadius: s.radius,
    elevation: s.elevation,
  }
}

// The type scale — one place, used everywhere. (Named `typo`, not `type`, to avoid the
// `import { type … }` TypeScript keyword ambiguity.)
//
// The serif roles carry the human voice: greetings, screen titles, and every FIGURE a member reads
// as a fact about herself — a class time, a remaining count, a kilogram. The sans roles carry the
// interface: labels, buttons, metadata. Reading a number in a serif is the single change that does
// most of the work here.
export const typo = {
  display: { fontFamily: serif, fontSize: 34, lineHeight: 42, letterSpacing: -0.4 } as TextStyle,
  h1: { fontFamily: serif, fontSize: 27, lineHeight: 34, letterSpacing: -0.3 } as TextStyle,
  h2: { fontSize: 18, fontWeight: '700', letterSpacing: -0.2 } as TextStyle,
  // Section labels: small, spaced, quiet. They organise without competing.
  // NO `textTransform: 'uppercase'` here, and that is the whole point. The platform's uppercase is
  // locale-blind: it maps Turkish "i" to "I" instead of "İ", so "Üyeliğin" became "ÜYELIĞIN" and
  // "Sıradaki dersin" became "SIRADAKI DERSIN" — visible on every label in the app. Turkish is the
  // only language the app speaks, so the transform belongs in `trUpper` below, applied to the STRING
  // where the alphabet is known, never to the box.
  eyebrow: { fontSize: 10.5, fontWeight: '700', letterSpacing: 1.4 } as TextStyle,
  body: { fontSize: 15, fontWeight: '500' } as TextStyle,
  bodyStrong: { fontSize: 15, fontWeight: '600' } as TextStyle,
  caption: { fontSize: 12.5, fontWeight: '500' } as TextStyle,
  // A figure the member reads. Tabular so a column of them lines up.
  num: { fontFamily: serif, fontSize: 34, lineHeight: 40, letterSpacing: -1, fontVariant: ['tabular-nums'] } as TextStyle,
  numSm: { fontFamily: serif, fontSize: 20, lineHeight: 25, letterSpacing: -0.3, fontVariant: ['tabular-nums'] } as TextStyle,
  // A sentence in the studio's voice — the motivation line, a quiet aside. Serif at body size.
  voice: { fontFamily: serif, fontSize: 16.5, lineHeight: 25 } as TextStyle,
}

/**
 * Uppercase, in Turkish.
 *
 * The two letters the platform gets wrong, both ways round: dotted i uppercases to İ (not I), and
 * dotless ı uppercases to I (not İ). Everything else defers to the runtime.
 */
export function trUpper(text: string): string {
  return text.replace(/i/g, '\u0130').replace(/\u0131/g, 'I').toUpperCase()
}
