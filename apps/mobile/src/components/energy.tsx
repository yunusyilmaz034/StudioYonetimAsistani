// The energy screens' moving parts (owner, 2026-10-13: *"biraz daha hareketli grafikler"*).
//
// Motion here always SHOWS SOMETHING: the ring sweeps to the proportions of her day, the figure
// counts up to the total, the week's bars rise to their heights. Nothing loops, nothing bounces for
// its own sake, and everything settles in under a second — she opened this to read a number.
import { useEffect, useRef, useState } from 'react'
import { StyleSheet, Text, View, type StyleProp, type TextStyle } from 'react-native'
import Animated, { Easing, useAnimatedProps, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated'
import Svg, { Circle } from 'react-native-svg'
import { Ionicons } from '@expo/vector-icons'
import { router } from 'expo-router'

import type { EnergyDayWire, EnergyState } from '@studio/core/client'
import { dayNote, kcal10, kcalText, trNum, weekdayShort } from '@/lib/energy'
import { PressableScale } from './motion'
import { PremiumCard, SectionHeader, Txt } from './kit'
import { space, typo as t, usePalette, type Palette } from '@/theme'

const AnimatedCircle = Animated.createAnimatedComponent(Circle)
const EASE = Easing.out(Easing.cubic)

/** The four parts of a day, in the order they are drawn, each with its colour. */
export function energyParts(p: Palette, d: EnergyDayWire) {
  return [
    { key: 'basal', label: 'Dinlenme', kcal: d.basalKcal, color: p.textMuted },
    { key: 'steps', label: 'Adım', kcal: d.stepsKcal, color: p.warning },
    { key: 'workout', label: 'Antrenman', kcal: d.workoutKcal, color: p.primary },
    { key: 'cardio', label: 'Kardiyo', kcal: d.cardioKcal, color: p.success },
  ] as const
}

/** A figure that counts up to its value. Re-runs when the value changes (a new entry landed). */
export function CountUp({ value, style, duration = 800 }: { value: number; style?: StyleProp<TextStyle>; duration?: number }) {
  const [shown, setShown] = useState(0)
  const from = useRef(0)
  useEffect(() => {
    const start = Date.now()
    const a = from.current
    let raf = 0
    const tick = () => {
      const k = Math.min(1, (Date.now() - start) / duration)
      const eased = 1 - Math.pow(1 - k, 3)
      setShown(Math.round(a + (value - a) * eased))
      if (k < 1) raf = requestAnimationFrame(tick)
      else from.current = value
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [value, duration])
  // Rounded to the ten while it runs too — the digits must not flicker through a precision the
  // settled figure will not claim.
  return <Text style={style}>{trNum(kcal10(shown))}</Text>
}

function Arc({ r, c, start, len, color, width, progress }: { r: number; c: number; start: number; len: number; color: string; width: number; progress: { value: number } }) {
  const props = useAnimatedProps(() => ({
    strokeDasharray: [Math.max(0.001, len * progress.value), c] as unknown as string,
    strokeDashoffset: -start * progress.value,
  }))
  return <AnimatedCircle cx={r + width} cy={r + width} r={r} stroke={color} strokeWidth={width} fill="none" strokeLinecap="butt" animatedProps={props} />
}

/** Her day as a ring: four arcs that sweep out together to the share each part has of the total. */
export function EnergyRing({ day, size = 168 }: { day: EnergyDayWire; size?: number }) {
  const p = usePalette()
  const width = 14
  const r = (size - width * 2) / 2
  const c = 2 * Math.PI * r
  const progress = useSharedValue(0)
  const total = Math.max(1, day.totalKcal)
  useEffect(() => {
    progress.value = 0
    progress.value = withDelay(120, withTiming(1, { duration: 900, easing: EASE }))
  }, [progress, day.totalKcal, day.date])
  // A hair of gap between arcs so four colours read as four parts, not a gradient.
  const GAP = 3
  let at = 0
  const arcs = energyParts(p, day)
    .filter((x) => x.kcal > 0)
    .map((x) => {
      const span = (x.kcal / total) * c
      const arc = { key: x.key, color: x.color, start: at, len: Math.max(0, span - GAP) }
      at += span
      return arc
    })
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }} accessible accessibilityLabel={`Bugün yaklaşık ${kcalText(day.totalKcal)} kalori`}>
      <Svg width={size} height={size} style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
        <Circle cx={r + width} cy={r + width} r={r} stroke={p.surfaceMuted} strokeWidth={width} fill="none" />
        {arcs.map((a) => (
          <Arc key={a.key} r={r} c={c} start={a.start} len={a.len} color={a.color} width={width} progress={progress} />
        ))}
      </Svg>
      <CountUp value={day.totalKcal} style={[t.num, { color: p.textPrimary }]} />
      <Txt role="caption" tone="muted">kcal · yaklaşık</Txt>
    </View>
  )
}

/** The four parts as a legend. Two columns, so it sits beside or beneath the ring. */
export function EnergyLegend({ day }: { day: EnergyDayWire }) {
  const p = usePalette()
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: space(2.5) }}>
      {energyParts(p, day).map((x) => (
        <View key={x.key} style={{ width: '50%', flexDirection: 'row', alignItems: 'center', gap: space(2) }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: x.color }} />
          <Txt role="caption" tone="secondary" style={{ flex: 1 }}>{x.label}</Txt>
          <Text style={[t.caption, { color: p.textPrimary, fontFamily: t.h3.fontFamily, paddingRight: space(4) }]}>{kcalText(x.kcal)}</Text>
        </View>
      ))}
    </View>
  )
}

function Bar({ share, activeShare, index, label, strong }: { share: number; activeShare: number; index: number; label: string; strong: boolean }) {
  const p = usePalette()
  const h = useSharedValue(0)
  useEffect(() => {
    h.value = withDelay(80 + index * 60, withTiming(1, { duration: 620, easing: EASE }))
  }, [h, index])
  const HEIGHT = 96
  const whole = useAnimatedStyle(() => ({ height: Math.max(4, HEIGHT * share * h.value) }))
  return (
    <View style={{ flex: 1, alignItems: 'center', gap: space(1.5) }}>
      <View style={{ height: HEIGHT, justifyContent: 'flex-end', alignSelf: 'stretch', alignItems: 'center' }}>
        {/* The resting part in the quiet colour, what she DID on top of it in the brand colour —
            the part of the bar she can change is the part that stands out. */}
        <Animated.View style={[{ width: '62%', borderRadius: 6, backgroundColor: p.surfaceMuted, overflow: 'hidden', justifyContent: 'flex-start' }, whole]}>
          <View style={{ height: `${Math.min(100, activeShare * 100)}%`, backgroundColor: strong ? p.primary : p.accent, opacity: strong ? 1 : 0.55 }} />
        </Animated.View>
      </View>
      <Text style={[t.caption, { fontSize: 11, color: strong ? p.textPrimary : p.textMuted, fontFamily: strong ? t.h3.fontFamily : t.caption.fontFamily }]}>{label}</Text>
    </View>
  )
}

/** The last seven days as bars that rise in sequence. Oldest on the left, today on the right. */
export function WeekBars({ days, selected, onSelect }: { days: readonly EnergyDayWire[]; selected?: string; onSelect?: (date: string) => void }) {
  const week = [...days].slice(0, 7).reverse()
  const max = Math.max(1, ...week.map((d) => d.totalKcal))
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
      {week.map((d, i) => {
        const bar = (
          <Bar
            share={d.totalKcal / max}
            activeShare={d.totalKcal > 0 ? d.activeKcal / d.totalKcal : 0}
            index={i}
            label={weekdayShort(d.date)}
            strong={selected ? selected === d.date : i === week.length - 1}
          />
        )
        return onSelect ? (
          <PressableScale key={d.date} onPress={() => onSelect(d.date)} style={{ flex: 1 }}>{bar}</PressableScale>
        ) : (
          <View key={d.date} style={{ flex: 1 }}>{bar}</View>
        )
      })}
    </View>
  )
}

/** The home screen's card. Not started ⇒ nothing at all: the invitation lives on the Antrenman tab. */
export function EnergyHomeCard({ state }: { state: EnergyState | null }) {
  const p = usePalette()
  if (!state?.started) return null
  const today = state.days[0]
  if (!today) return null
  return (
    <View>
      <SectionHeader action="Geçmiş" onAction={() => router.push('/energy/history')}>Bugün yaktığın</SectionHeader>
      <PremiumCard onPress={() => router.push('/energy')}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(4) }}>
          <EnergyRing day={today} size={132} />
          <View style={{ flex: 1, gap: space(2) }}>
            {energyParts(p, today).map((x) => (
              <View key={x.key} style={{ flexDirection: 'row', alignItems: 'center', gap: space(2) }}>
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: x.color }} />
                <Txt role="caption" tone="secondary" style={{ flex: 1 }}>{x.label}</Txt>
                <Text style={[t.caption, { color: p.textPrimary, fontFamily: t.h3.fontFamily }]}>{kcalText(x.kcal)}</Text>
              </View>
            ))}
          </View>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(1.5), marginTop: space(3), paddingTop: space(3), borderTopWidth: StyleSheet.hairlineWidth * 2, borderColor: p.border }}>
          <Ionicons name="add-circle-outline" size={16} color={p.primary} />
          <Txt role="caption" tone="brand" style={{ flex: 1 }}>
            {today.activeKcal > 0 ? `Bugün: ${dayNote(today)}` : 'Adımını ya da kardiyonu ekle'}
          </Txt>
          <Ionicons name="chevron-forward" size={14} color={p.textMuted} />
        </View>
      </PremiumCard>
    </View>
  )
}

/** The Antrenman tab's card: the invitation before she starts, a one-line summary after. */
export function EnergyTrainingCard({ state }: { state: EnergyState | null }) {
  const p = usePalette()
  if (!state) return null
  if (state.started) {
    const today = state.days[0]
    return (
      <View>
        <SectionHeader>Kalori takibi</SectionHeader>
        <PremiumCard onPress={() => router.push('/energy')}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(3) }}>
            <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: p.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="flame-outline" size={18} color={p.primary} />
            </View>
            <View style={{ flex: 1, gap: space(1) }}>
              <Txt role="h3">Bugün yaklaşık {today ? kcalText(today.totalKcal) : '—'} kcal</Txt>
              <Txt role="caption" tone="muted">{today && today.activeKcal > 0 ? `${kcalText(today.activeKcal)} kcal hareketten` : 'Bugün için henüz giriş yok'}</Txt>
            </View>
            <Ionicons name="chevron-forward" size={16} color={p.textMuted} />
          </View>
        </PremiumCard>
      </View>
    )
  }
  return (
    <View style={{ backgroundColor: p.primary, borderRadius: 20, padding: space(5), gap: space(3) }}>
      <Ionicons name="flame-outline" size={28} color={p.onPrimary} />
      <Text style={[t.h2, { color: p.onPrimary }]}>Bugün kaç kalori yaktın?</Text>
      <Text style={[t.body, { color: p.onGradMuted }]}>Antrenmanın, adımların ve kardiyon tek yerde toplansın. Kurulum bir dakika sürer.</Text>
      <PressableScale onPress={() => router.push('/energy/start')}>
        <View style={{ minHeight: 48, borderRadius: 14, backgroundColor: p.surfaceElevated, alignItems: 'center', justifyContent: 'center', marginTop: space(1) }}>
          <Text style={[t.button, { color: p.primary }]}>Kalori takibini başlat</Text>
        </View>
      </PressableScale>
    </View>
  )
}

