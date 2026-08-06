import { useEffect } from 'react'
import { StyleSheet, Text } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import * as Notifications from 'expo-notifications'
import { Redirect, router, Tabs } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { useAuth } from '@/lib/auth'
import { api } from '@/lib/api'
import { useFetch } from '@/lib/useFetch'
import { registerForPush } from '@/lib/push'
import { Loading } from '@/components/ui'
import { radius, usePalette } from '@/theme'

// ── The bar (owner, 2026-08-06, third attempt) ──────────────────────────────────────────────
//
// It was words only, with a small rule under the selected one — the agenda's day-picker mark, reused
// for consistency. Consistency was the wrong goal here. A word-only bar gives the thumb nothing to
// aim at and the eye nothing to land on, so four labels in a row read as a caption strip rather than
// navigation, and no amount of spacing fixed it ("tabbar hala çok kötü duruyo").
//
// So: a line icon over a small label, which is what the platform's own bar is and what the hand
// already knows. Nothing else about the language changes — the icons are outlines on the same bone
// paper, and selection is still mahogany, not a filled pill.
const ICONS: Record<string, [keyof typeof Ionicons.glyphMap, keyof typeof Ionicons.glyphMap]> = {
  index: ['today-outline', 'today'],
  agenda: ['calendar-outline', 'calendar'],
  training: ['barbell-outline', 'barbell'],
  measurements: ['pulse-outline', 'pulse'],
  profile: ['person-outline', 'person'],
}

// The icon and the label are handed to react-navigation SEPARATELY, through `tabBarIcon` and
// `tabBarLabel`. Putting both inside the label — which is what the previous version did to get them
// stacked — leaves the icon slot reserved and empty above them, and the pair is pushed down through
// the safe area until the words sit under the home indicator. Two slots, laid out by the navigator.
function tabIcon(name: keyof typeof ICONS) {
  return function Icon({ focused, color }: { focused: boolean; color: string }) {
    const [outline, solid] = ICONS[name]
    return <Ionicons name={focused ? solid : outline} size={22} color={color} />
  }
}

function tabLabel(label: string) {
  return function Label({ color, focused }: { color: string; focused: boolean }) {
    return (
      <Text numberOfLines={1} style={{ fontSize: 10.5, letterSpacing: 0.2, fontWeight: focused ? '700' : '500', color }}>
        {label}
      </Text>
    )
  }
}

export default function TabsLayout() {
  const p = usePalette()
  const insets = useSafeAreaInsets()
  const { user, loading } = useAuth()
  // A pilates-only member has no workout programme — her tab is really just her measurements, so it
  // reads "Ölçümlerim" (owner, 2026-08-02).
  //
  // The answer comes from the SAME place the screen uses: `TrainingBundle.showPrograms`, decided by
  // the server. It used to be guessed here from her subscriptions, and a label guessed one way while
  // the screen decided another is a tab that says "Antrenman" and opens on measurements. The server
  // also knows something this side cannot — a member who somehow HAS a programme keeps it, whatever
  // her packages say.
  //
  // Defaults to programmes while loading, so a gym member does not see her tab flicker.
  const training = useFetch(api.training)
  const showPrograms = training.data ? training.data.showPrograms : true

  // Register for push once she is signed in, and route a tapped notification to her inbox (M2).
  useEffect(() => {
    if (!user) return
    void registerForPush()
    const sub = Notifications.addNotificationResponseReceivedListener(() => {
      router.push('/messages')
    })
    return () => sub.remove()
  }, [user])

  if (loading) return <Loading />
  if (!user) return <Redirect href="/login" />

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: p.accent,
        tabBarInactiveTintColor: p.textFaint,
        // A fixed `height` overrides the safe-area inset, which is what pushed the labels down onto
        // the home indicator (owner, 2026-08-06). Height is the icon-and-label block plus the inset,
        // and nothing else.
        tabBarStyle: {
          backgroundColor: p.bg,
          borderTopColor: p.hairline,
          borderTopWidth: StyleSheet.hairlineWidth * 2,
          height: 50 + insets.bottom,
          paddingTop: 7,
          paddingBottom: insets.bottom,
        },
        tabBarItemStyle: { paddingTop: 0 },
        tabBarIconStyle: { marginBottom: -2 },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Bugün', tabBarIcon: tabIcon('index'), tabBarLabel: tabLabel('Bugün') }} />
      <Tabs.Screen name="agenda" options={{ title: 'Ajanda', tabBarIcon: tabIcon('agenda'), tabBarLabel: tabLabel('Ajanda') }} />
      {/* The third tab is the member's own body and training, and its NAME depends on what she bought:
          a pilates-only member has no programme, so she must not meet the word "Antrenman" — not as a
          label, not as an empty state (owner, 2026-08-06). The answer comes from the server, never
          guessed here from her packages: a label guessed one way while the screen decides another is a
          tab that says "Antrenman" and opens on measurements. */}
      <Tabs.Screen
        name="training"
        options={{
          title: showPrograms ? 'Antrenman' : 'Ölçümlerim',
          // The icon follows the label: a barbell for a programme, a pulse line for measurements.
          tabBarIcon: tabIcon(showPrograms ? 'training' : 'measurements'),
          tabBarLabel: tabLabel(showPrograms ? 'Antrenman' : 'Ölçümlerim'),
        }}
      />
      {/* Üyeliğim, Cüzdan, Mesajlar and Profil are one question — "ben neyim, nerede duruyorum" — so
          they are one screen. Nothing was removed; see app/(tabs)/profile.tsx. */}
      <Tabs.Screen name="profile" options={{ title: 'Ben', tabBarIcon: tabIcon('profile'), tabBarLabel: tabLabel('Ben') }} />
      {/* Kept as a route so every existing link still resolves, but off the bar: QR is reached from
          each screen's top-right, and Üyeliğim now lives inside Ben. */}
      <Tabs.Screen name="qr" options={{ href: null }} />
      <Tabs.Screen name="subscriptions" options={{ href: null }} />
    </Tabs>
  )
}
