// The premium UI kit — every screen composes from these so the app reads as one designed system.
import type { ReactNode } from 'react'
import { ActivityIndicator, ScrollView, StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import Svg, { Circle, Defs, G, LinearGradient, Path, Rect, Stop } from 'react-native-svg'

import { radius, shadow, space, typo as t, usePalette } from '@/theme'
import { PressableScale } from './motion'

// A real diagonal gradient fill (react-native-svg — already in the app for the QR code), the backbone
// of the premium look. No extra native dependency.
export function GradientFill({ from, to }: { from: string; to: string }) {
  return (
    <Svg style={StyleSheet.absoluteFill} width="100%" height="100%">
      <Defs>
        <LinearGradient id="g" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={from} />
          <Stop offset="1" stopColor={to} />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" fill="url(#g)" />
    </Svg>
  )
}

// A chic line-art silhouette of a woman in a seated pilates/meditation pose (hair in a sporty bun) —
// the hero's contextual signature. Pure vector: subtle white fill + a thin gold edge, no photo, no
// native dependency. Cropped by the hero's rounded corners so it reads as an embossed motif.
export function HeroFigure({ tint = '#FFFFFF', gold = '#D9A441' }: { tint?: string; gold?: string }) {
  const body =
    'M82 76 C72 96 66 108 64 122 C62 133 67 141 75 145 C63 148 55 156 57 165 ' +
    'C59 173 69 179 84 181 L110 183 L136 181 C151 179 161 173 163 165 ' +
    'C165 156 157 148 145 145 C153 141 158 133 156 122 C154 108 148 96 138 76 ' +
    'C131 68 121 65 110 65 C99 65 89 68 82 76 Z'
  return (
    <Svg width={214} height={196} viewBox="0 0 220 200">
      <G>
        {/* bun + head */}
        <Circle cx={110} cy={26} r={8.5} fill={tint} fillOpacity={0.08} stroke={gold} strokeOpacity={0.28} strokeWidth={1.4} />
        <Circle cx={110} cy={47} r={16} fill={tint} fillOpacity={0.08} stroke={gold} strokeOpacity={0.28} strokeWidth={1.4} />
        {/* seated body with hands resting on knees */}
        <Path d={body} fill={tint} fillOpacity={0.07} stroke={gold} strokeOpacity={0.26} strokeWidth={1.5} strokeLinejoin="round" />
      </G>
    </Svg>
  )
}

export function Screen({ children, scroll = true, refreshControl, header }: { children: ReactNode; scroll?: boolean; refreshControl?: ReactNode; header?: boolean }) {
  const p = usePalette()
  // `header` = a stack header is already shown above, so don't add the top safe-area inset (that was the
  // double gap on the program detail), and start content close to the header.
  const edges = header ? ([] as const) : (['top'] as const)
  const topPad = header ? space(4) : space(2)
  if (!scroll) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: p.bg }} edges={edges}>
        <View style={{ flex: 1, paddingHorizontal: space(5), paddingTop: topPad, gap: space(3) }}>{children}</View>
      </SafeAreaView>
    )
  }
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: p.bg }} edges={edges}>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: space(5), paddingTop: topPad, paddingBottom: space(10), gap: space(3.5) }}
        showsVerticalScrollIndicator={false}
        refreshControl={refreshControl as never}
      >
        {children}
      </ScrollView>
    </SafeAreaView>
  )
}

export function Title({ children, sub }: { children: ReactNode; sub?: string }) {
  const p = usePalette()
  return (
    <View style={{ gap: 2, marginBottom: space(1) }}>
      <Text style={[t.display, { color: p.text }]}>{children}</Text>
      {sub ? <Text style={[t.caption, { color: p.textMuted }]}>{sub}</Text> : null}
    </View>
  )
}

export function Eyebrow({ children, right }: { children: ReactNode; right?: ReactNode }) {
  const p = usePalette()
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: space(1.5), marginBottom: space(2.5) }}>
      <Text style={[t.eyebrow, { color: p.textMuted }]}>{children}</Text>
      {right}
    </View>
  )
}

export function Body({ children, muted, faint, strong, style, numberOfLines, onPress }: { children: ReactNode; muted?: boolean; faint?: boolean; strong?: boolean; style?: StyleProp<TextStyle>; numberOfLines?: number; onPress?: () => void }) {
  const p = usePalette()
  return (
    <Text onPress={onPress} numberOfLines={numberOfLines} style={[strong ? t.bodyStrong : t.body, { color: faint ? p.textFaint : muted ? p.textMuted : p.text }, style]}>
      {children}
    </Text>
  )
}

export function Card({ children, style, onPress, level = 1, inset }: { children: ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void; level?: 1 | 2 | 3; inset?: boolean }) {
  const p = usePalette()
  const body = (
    <View
      style={[
        {
          backgroundColor: p.surface,
          borderColor: p.hairline,
          borderWidth: 1,
          borderRadius: radius.lg,
          padding: inset ? space(3.5) : space(4.5),
          gap: space(2.5),
        },
        shadow(level),
        style,
      ]}
    >
      {children}
    </View>
  )
  return onPress ? <PressableScale onPress={onPress}>{body}</PressableScale> : body
}

// The premium hero header — a deep mahogany band with a soft glow, used at the top of each main screen.
export function Hero({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const p = usePalette()
  return (
    <View style={[{ borderRadius: radius.xl, overflow: 'hidden' }, shadow(3), style]}>
      <GradientFill from={p.gradFrom} to={p.gradTo} />
      {/* layered glows for real depth */}
      <View style={{ position: 'absolute', top: -80, right: -50, width: 220, height: 220, borderRadius: 110, backgroundColor: '#FFFFFF', opacity: 0.1 }} />
      <View style={{ position: 'absolute', top: 20, right: 30, width: 90, height: 90, borderRadius: 45, backgroundColor: p.gold, opacity: 0.12 }} />
      <View style={{ position: 'absolute', bottom: -90, left: -60, width: 240, height: 240, borderRadius: 120, backgroundColor: '#FFFFFF', opacity: 0.05 }} />
      {/* the contextual signature — a woman athlete silhouette anchored bottom-right */}
      <View style={{ position: 'absolute', right: -6, bottom: -12 }} pointerEvents="none">
        <HeroFigure gold={p.gold} />
      </View>
      <View style={{ padding: space(5.5), gap: space(2) }}>{children}</View>
    </View>
  )
}

export function Pill({ label, tone = 'muted', solid, icon }: { label: string; tone?: 'muted' | 'good' | 'warn' | 'danger' | 'accent' | 'gold'; solid?: boolean; icon?: ReactNode }) {
  const p = usePalette()
  const c = tone === 'good' ? p.good : tone === 'warn' ? p.warn : tone === 'danger' ? p.danger : tone === 'accent' ? p.accent : tone === 'gold' ? p.gold : p.textMuted
  const bg = tone === 'good' ? p.goodSoft : tone === 'warn' ? p.warnSoft : tone === 'danger' ? p.dangerSoft : tone === 'accent' ? p.accentSoft : p.surfaceMuted
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', paddingHorizontal: space(2.5), paddingVertical: space(1.25), borderRadius: radius.pill, backgroundColor: solid ? c : bg }}>
      {icon}
      <Text style={{ color: solid ? p.accentText : c, fontSize: 12.5, fontWeight: '700' }}>{label}</Text>
    </View>
  )
}

export function Button({ label, onPress, disabled, tone = 'accent', loading, icon }: { label: string; onPress: () => void; disabled?: boolean; tone?: 'accent' | 'muted' | 'danger'; loading?: boolean; icon?: ReactNode }) {
  const p = usePalette()
  const bg = tone === 'accent' ? p.accent : tone === 'danger' ? p.danger : p.surfaceMuted
  const fg = tone === 'muted' ? p.text : p.accentText
  return (
    <PressableScale onPress={disabled || loading ? undefined : onPress} disabled={disabled || loading}>
      <View
        style={[
          { backgroundColor: bg, opacity: disabled ? 0.5 : 1, borderRadius: radius.md, paddingVertical: space(3.75), paddingHorizontal: space(7), alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, minHeight: 52 },
          tone === 'accent' ? shadow(1) : null,
        ]}
      >
        {loading ? <ActivityIndicator color={fg} /> : icon}
        <Text style={{ color: fg, fontSize: 16, fontWeight: '700' }}>{label}</Text>
      </View>
    </PressableScale>
  )
}

// Back-compat aliases for the secondary stack screens (reservations / wallet / messages / login).
export function H1({ children }: { children: ReactNode }) {
  const p = usePalette()
  return <Text style={[t.display, { color: p.text, marginBottom: space(1) }]}>{children}</Text>
}
export function H2({ children }: { children: ReactNode }) {
  const p = usePalette()
  return <Text style={[t.eyebrow, { color: p.textMuted, marginTop: space(2) }]}>{children}</Text>
}

export function Loading() {
  const p = usePalette()
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: p.bg }}>
      <ActivityIndicator color={p.accent} size="large" />
    </View>
  )
}

export function Empty({ text, icon }: { text: string; icon?: ReactNode }) {
  const p = usePalette()
  return (
    <View style={{ alignItems: 'center', gap: space(2), paddingVertical: space(6), paddingHorizontal: space(4) }}>
      {icon}
      <Body muted style={{ textAlign: 'center' }}>{text}</Body>
    </View>
  )
}
