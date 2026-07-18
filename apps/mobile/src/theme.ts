// The member app's design tokens — the studio's premium character (warm mahogany + off-white), kept
// deliberately small and semantic so every screen reads from the same palette (matches the web DS).
import { useColorScheme } from 'react-native'

const light = {
  bg: '#F4F1EE',
  surface: '#FFFFFF',
  surfaceMuted: '#EFEAE4',
  border: '#E4DCD3',
  text: '#1F1A17',
  textMuted: '#7A6E64',
  accent: '#7A1F3D', // mahogany
  accentText: '#FFFFFF',
  good: '#2E7D5B',
  warn: '#B4690E',
  danger: '#B23A3A',
} as const

const dark = {
  bg: '#151011',
  surface: '#211A1C',
  surfaceMuted: '#2A2124',
  border: '#382C30',
  text: '#F3ECEA',
  textMuted: '#A99B96',
  accent: '#C56A86',
  accentText: '#1A1113',
  good: '#5FBE93',
  warn: '#E0A45B',
  danger: '#E08585',
} as const

export type Palette = typeof light

export function usePalette(): Palette {
  return useColorScheme() === 'dark' ? dark : light
}

export const radius = { sm: 10, md: 14, lg: 20 }
export const space = (n: number) => n * 4
