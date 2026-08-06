import { useEffect } from 'react'
import { View } from 'react-native'
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated'

import { weeklyVisitCounts } from '@studio/core/client'
import { Body } from '@/components/ui'
import { space, usePalette } from '@/theme'

// ── DEVAMLILIK ŞERİDİ (owner, 2026-08-06) ────────────────────────────────────────────────────
//
// Eight weeks of DOOR check-ins — the studio's own observation, never the workout ticks. The two
// are drawn separately and labelled separately for the reason in core's events.ts (#11): summing a
// declaration into an observation destroys both.
//
// THE RULE THAT DECIDES WHETHER IT APPEARS AT ALL. A chart of mostly-empty weeks is not neutral —
// to a member who had a reason the app cannot know (illness, a child, a shift pattern), it reads as
// an accusation, and the app she feels judged by is the one she stops opening. So it renders only
// once there is a real pattern to show, and it says only what she DID. What she missed is Işıl's to
// see on the staff screen, where a human can pick up a phone and ask.
//
// Same rule as the motivation line and the same reason: say nothing rather than something you
// cannot stand behind.

export function ConsistencyStrip({ recent, now }: { recent: readonly number[]; now: number }) {
  const p = usePalette()
  const weeks = weeklyVisitCounts(recent, now)
  if (!weeks) return null
  const peak = Math.max(...weeks, 1)
  const total = weeks.reduce((n, w) => n + w, 0)

  return (
    <View style={{ gap: space(3) }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 6, height: 56 }}>
        {weeks.map((n, i) => (
          <Bar key={i} index={i} ratio={n / peak} empty={n === 0} />
        ))}
      </View>
      <Body faint style={{ fontSize: 11.5 }}>
        Son 8 hafta · {total} ziyaret
      </Body>
    </View>
  )
}

function Bar({ index, ratio, empty }: { index: number; ratio: number; empty: boolean }) {
  const p = usePalette()
  const h = useSharedValue(0)
  useEffect(() => {
    h.value = withDelay(200 + index * 60, withTiming(Math.max(0.08, ratio), { duration: 520, easing: Easing.out(Easing.cubic) }))
  }, [h, ratio, index])
  const style = useAnimatedStyle(() => ({ height: `${h.value * 100}%` }))
  return (
    <View style={{ flex: 1, height: '100%', justifyContent: 'flex-end' }}>
      {/* A week with no visit is a HAIRLINE, not an empty slot shouting at her. It keeps the rhythm
          of the chart readable without turning a quiet week into a mark against her. */}
      <Animated.View
        style={[{ borderRadius: 3, backgroundColor: empty ? p.hairline : p.good }, style]}
      />
    </View>
  )
}
