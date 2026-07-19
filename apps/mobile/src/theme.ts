// The member app's design language — a warm, premium studio identity (mahogany + bone) with real depth
// (layered surfaces, soft shadows) and a considered type scale. Semantic tokens only; every screen reads
// from here so the whole app moves as one system.
import { useColorScheme, type TextStyle, type ViewStyle } from 'react-native'

const light = {
  bg: '#F1ECE6',
  bgElevated: '#F7F3EE',
  surface: '#FFFFFF',
  surfaceMuted: '#EBE4DB',
  border: '#E6DDD2',
  hairline: '#00000010',
  text: '#211A16',
  textMuted: '#8A7C70',
  textFaint: '#B3A79B',
  accent: '#7A1F3D',
  accentSoft: '#7A1F3D18',
  accentDeep: '#5C1730',
  accentText: '#FFFFFF',
  gold: '#B98A4B',
  good: '#2E7D5B',
  goodSoft: '#2E7D5B18',
  warn: '#B4690E',
  warnSoft: '#B4690E1A',
  danger: '#B23A3A',
  dangerSoft: '#B23A3A18',
  // gradient stops for the premium header
  gradFrom: '#7A1F3D',
  gradTo: '#4E1226',
  onGrad: '#FFFFFF',
  onGradMuted: '#F3D9E2',
} as const

const dark = {
  bg: '#131011',
  bgElevated: '#1B1618',
  surface: '#221B1E',
  surfaceMuted: '#2C2327',
  border: '#3A2E33',
  hairline: '#FFFFFF12',
  text: '#F4EDEB',
  textMuted: '#A99B96',
  textFaint: '#6F625E',
  accent: '#D07A94',
  accentSoft: '#D07A9422',
  accentDeep: '#B65E79',
  accentText: '#1A1113',
  gold: '#D6A661',
  good: '#5FBE93',
  goodSoft: '#5FBE9322',
  warn: '#E0A45B',
  warnSoft: '#E0A45B22',
  danger: '#E08585',
  dangerSoft: '#E0858522',
  gradFrom: '#7A1F3D',
  gradTo: '#2A0A16',
  onGrad: '#FFFFFF',
  onGradMuted: '#E9C7D2',
} as const

export type Palette = typeof light

export function usePalette(): Palette {
  return useColorScheme() === 'dark' ? dark : light
}

export const radius = { sm: 12, md: 18, lg: 24, xl: 30, pill: 999 }
export const space = (n: number) => n * 4

// A soft, premium elevation. iOS reads shadow*, Android reads elevation.
export const shadow = (level: 1 | 2 | 3 = 1): ViewStyle => {
  const map = {
    1: { radius: 12, y: 4, opacity: 0.06, elevation: 2 },
    2: { radius: 22, y: 10, opacity: 0.1, elevation: 6 },
    3: { radius: 34, y: 18, opacity: 0.16, elevation: 12 },
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

// The type scale — one place, used everywhere. (Named `typo`, not `type`, to avoid the `import { type … }`
// TypeScript keyword ambiguity.)
export const typo = {
  display: { fontSize: 30, fontWeight: '800', letterSpacing: -0.5 } as TextStyle,
  h1: { fontSize: 24, fontWeight: '800', letterSpacing: -0.3 } as TextStyle,
  h2: { fontSize: 18, fontWeight: '700', letterSpacing: -0.2 } as TextStyle,
  eyebrow: { fontSize: 12, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase' } as TextStyle,
  body: { fontSize: 15, fontWeight: '500' } as TextStyle,
  bodyStrong: { fontSize: 15, fontWeight: '700' } as TextStyle,
  caption: { fontSize: 13, fontWeight: '500' } as TextStyle,
  num: { fontSize: 34, fontWeight: '800', letterSpacing: -1, fontVariant: ['tabular-nums'] } as TextStyle,
}
