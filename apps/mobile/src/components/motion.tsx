// Reanimated motion primitives — the difference between "a list of cards" and a premium app. Every
// screen composes from these: content springs in on mount (staggered), and anything tappable presses.
import { useEffect, type ReactNode } from 'react'
import { Pressable, type StyleProp, type ViewStyle } from 'react-native'
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from 'react-native-reanimated'

// Content that rises + fades in on mount. `index` staggers a list so cards cascade rather than pop.
export function FadeInUp({
  children,
  index = 0,
  delay = 0,
  distance = 16,
  style,
}: {
  children: ReactNode
  index?: number
  delay?: number
  distance?: number
  style?: StyleProp<ViewStyle>
}) {
  const p = useSharedValue(0)
  useEffect(() => {
    p.value = withDelay(delay + index * 70, withTiming(1, { duration: 460, easing: Easing.out(Easing.cubic) }))
  }, [p, index, delay])
  const anim = useAnimatedStyle(() => ({
    opacity: p.value,
    transform: [{ translateY: (1 - p.value) * distance }],
  }))
  return <Animated.View style={[style, anim]}>{children}</Animated.View>
}

// A tappable surface that springs down on press — the tactile feel of a native, premium control.
export function PressableScale({
  children,
  onPress,
  disabled,
  style,
}: {
  children: ReactNode
  onPress?: () => void
  disabled?: boolean
  style?: StyleProp<ViewStyle>
}) {
  const s = useSharedValue(1)
  const anim = useAnimatedStyle(() => ({ transform: [{ scale: s.value }] }))
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      onPressIn={() => (s.value = withSpring(0.97, { damping: 18, stiffness: 320 }))}
      onPressOut={() => (s.value = withSpring(1, { damping: 14, stiffness: 260 }))}
    >
      <Animated.View style={[style, anim]}>{children}</Animated.View>
    </Pressable>
  )
}

// A thin progress bar that fills on mount — used for credits / package usage.
export function ProgressBar({ value, color, track, height = 8 }: { value: number; color: string; track: string; height?: number }) {
  const p = useSharedValue(0)
  useEffect(() => {
    p.value = withDelay(200, withTiming(Math.max(0, Math.min(1, value)), { duration: 700, easing: Easing.out(Easing.cubic) }))
  }, [p, value])
  const fill = useAnimatedStyle(() => ({ width: `${p.value * 100}%` }))
  return (
    <Animated.View style={{ height, borderRadius: height, backgroundColor: track, overflow: 'hidden' }}>
      <Animated.View style={[{ height, borderRadius: height, backgroundColor: color }, fill]} />
    </Animated.View>
  )
}
