// The premium UI kit — every screen composes from these so the app reads as one designed system.
import type { ReactNode } from 'react'
import { ActivityIndicator, ScrollView, StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import Svg, { Circle, Defs, G, LinearGradient, Path, Rect, Stop } from 'react-native-svg'

import { radius, shadow, space, typo as t, usePalette } from '@/theme'
import { PressableScale } from './motion'

// A real gradient fill (react-native-svg — already in the app for the QR code), the backbone of the
// premium look. No extra native dependency. Transparency goes through `fromOpacity`/`toOpacity` (the
// stopOpacity prop) — NOT 8-digit hex alpha, which react-native-svg silently renders as opaque (that
// bug turned the image banner into a solid black block). `id` is unique per use so two gradients on
// one screen never collide.
export function GradientFill({
  from,
  to,
  fromOpacity = 1,
  toOpacity = 1,
  vertical = false,
  id = 'g',
}: {
  from: string
  to: string
  fromOpacity?: number
  toOpacity?: number
  vertical?: boolean
  id?: string
}) {
  return (
    <Svg style={StyleSheet.absoluteFill} width="100%" height="100%">
      <Defs>
        <LinearGradient id={id} x1="0" y1="0" x2={vertical ? '0' : '1'} y2="1">
          <Stop offset="0" stopColor={from} stopOpacity={fromOpacity} />
          <Stop offset="1" stopColor={to} stopOpacity={toOpacity} />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${id})`} />
    </Svg>
  )
}

// The hero's contextual signature — a composed pilates/fitness scene, all vector, no photo, no native
// dependency. A line-art woman seated in a meditation pose (sporty top-bun, hands resting on knees)
// sits inside concentric motion rings, with a small dumbbell and a scatter of sparkles for a premium,
// unmistakably-fitness read. Drawn in gold over the mahogany so it glows rather than smudges.
const sparklePath = (cx: number, cy: number, r: number) => {
  const k = r * 0.16
  return (
    `M${cx} ${cy - r} C${cx + k} ${cy - k} ${cx + k} ${cy - k} ${cx + r} ${cy} ` +
    `C${cx + k} ${cy + k} ${cx + k} ${cy + k} ${cx} ${cy + r} ` +
    `C${cx - k} ${cy + k} ${cx - k} ${cy + k} ${cx - r} ${cy} ` +
    `C${cx - k} ${cy - k} ${cx - k} ${cy - k} ${cx} ${cy - r} Z`
  )
}

export function HeroFigure({ tint = '#FFFFFF', gold = '#D9A441' }: { tint?: string; gold?: string }) {
  const stroke = { stroke: gold, strokeWidth: 2.4, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' }
  return (
    <Svg width={210} height={200} viewBox="0 0 200 200">
      {/* motion rings — energy, centred on the figure */}
      <Circle cx={112} cy={112} r={82} stroke={tint} strokeOpacity={0.09} strokeWidth={1.4} fill="none" />
      <Circle cx={112} cy={112} r={60} stroke={tint} strokeOpacity={0.06} strokeWidth={1.2} fill="none" />
      {/* seated meditation woman, line-art */}
      <G opacity={0.6}>
        <Circle cx={112} cy={44} r={7} {...stroke} />
        <Circle cx={112} cy={61} r={13} {...stroke} />
        <Path d="M84 85 Q112 75 140 85" {...stroke} />
        <Path d="M84 85 Q70 109 85 135" {...stroke} />
        <Path d="M140 85 Q154 109 139 135" {...stroke} />
        <Path d="M85 135 Q112 157 135 149" {...stroke} />
        <Path d="M139 135 Q112 157 89 149" {...stroke} />
      </G>
      {/* a small dumbbell — the fitness note */}
      <G opacity={0.34}>
        <Rect x={46} y={70} width={22} height={3.2} rx={1.6} fill={gold} />
        <Rect x={42} y={65} width={5} height={13} rx={2} fill={gold} />
        <Rect x={67} y={65} width={5} height={13} rx={2} fill={gold} />
      </G>
      {/* sparkles */}
      <Path d={sparklePath(62, 128, 6)} fill={gold} opacity={0.42} />
      <Path d={sparklePath(150, 156, 5)} fill={gold} opacity={0.36} />
      <Path d={sparklePath(96, 34, 4.5)} fill={gold} opacity={0.4} />
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
// `gradient` lets a screen tint the band by context (e.g. the home shifts it with the time of day).
export function Hero({ children, style, gradient }: { children: ReactNode; style?: StyleProp<ViewStyle>; gradient?: { from: string; to: string } }) {
  const p = usePalette()
  return (
    <View style={[{ borderRadius: radius.xl, overflow: 'hidden' }, shadow(3), style]}>
      <GradientFill from={gradient?.from ?? p.gradFrom} to={gradient?.to ?? p.gradTo} />
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
