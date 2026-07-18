// A tiny, semantic UI kit so every screen reads from the same palette + spacing (mirrors the web DS).
import type { ReactNode } from 'react'
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { radius, space, usePalette } from '@/theme'

export function Screen({ children, scroll = true, refreshControl }: { children: ReactNode; scroll?: boolean; refreshControl?: ReactNode }) {
  const p = usePalette()
  const body = scroll ? (
    <ScrollView
      contentContainerStyle={{ padding: space(4), gap: space(3) }}
      refreshControl={refreshControl as never}
    >
      {children}
    </ScrollView>
  ) : (
    <View style={{ flex: 1, padding: space(4), gap: space(3) }}>{children}</View>
  )
  return <SafeAreaView style={{ flex: 1, backgroundColor: p.bg }} edges={['top']}>{body}</SafeAreaView>
}

export function H1({ children }: { children: ReactNode }) {
  const p = usePalette()
  return <Text style={{ fontSize: 26, fontWeight: '700', color: p.text }}>{children}</Text>
}

export function H2({ children }: { children: ReactNode }) {
  const p = usePalette()
  return <Text style={{ fontSize: 13, fontWeight: '700', letterSpacing: 0.6, color: p.textMuted, textTransform: 'uppercase' }}>{children}</Text>
}

export function Body({ children, muted }: { children: ReactNode; muted?: boolean }) {
  const p = usePalette()
  return <Text style={{ fontSize: 15, color: muted ? p.textMuted : p.text }}>{children}</Text>
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const p = usePalette()
  return (
    <View style={[{ backgroundColor: p.surface, borderColor: p.border, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, padding: space(4), gap: space(2) }, style]}>
      {children}
    </View>
  )
}

export function Button({ label, onPress, disabled, tone = 'accent', loading }: { label: string; onPress: () => void; disabled?: boolean; tone?: 'accent' | 'muted' | 'danger'; loading?: boolean }) {
  const p = usePalette()
  const bg = tone === 'accent' ? p.accent : tone === 'danger' ? p.danger : p.surfaceMuted
  const fg = tone === 'muted' ? p.text : p.accentText
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => ({
        backgroundColor: bg,
        opacity: disabled ? 0.5 : pressed ? 0.85 : 1,
        borderRadius: radius.md,
        paddingVertical: space(3.5),
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 48,
      })}
    >
      {loading ? <ActivityIndicator color={fg} /> : <Text style={{ color: fg, fontSize: 16, fontWeight: '600' }}>{label}</Text>}
    </Pressable>
  )
}

export function Pill({ label, tone = 'muted' }: { label: string; tone?: 'muted' | 'good' | 'warn' | 'danger' }) {
  const p = usePalette()
  const color = tone === 'good' ? p.good : tone === 'warn' ? p.warn : tone === 'danger' ? p.danger : p.textMuted
  return (
    <View style={{ alignSelf: 'flex-start', paddingHorizontal: space(2.5), paddingVertical: space(1), borderRadius: 999, backgroundColor: color + '22' }}>
      <Text style={{ color, fontSize: 12, fontWeight: '600' }}>{label}</Text>
    </View>
  )
}

export function Loading() {
  const p = usePalette()
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: p.bg }}>
      <ActivityIndicator color={p.accent} size="large" />
    </View>
  )
}

export function Empty({ text }: { text: string }) {
  return (
    <Card>
      <Body muted>{text}</Body>
    </Card>
  )
}
