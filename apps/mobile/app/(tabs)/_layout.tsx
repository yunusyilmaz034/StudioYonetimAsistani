import { useEffect } from 'react'
import { StyleSheet, Text, View } from 'react-native'
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

// Selection is a word with a rule under it — the same underline the agenda's day picker uses, so
// "this is the one you are on" reads identically everywhere in the app. The icon pill is gone with
// the rest of the filled-shape language.
function TabLabel({ label, focused }: { label: string; focused: boolean }) {
  const p = usePalette()
  return (
    <View style={{ alignItems: 'center', gap: 3, width: 90 }}>
      <Text numberOfLines={1} style={{ fontSize: 11.5, fontWeight: focused ? '700' : '600', color: focused ? p.accent : p.textFaint }}>
        {label}
      </Text>
      <View style={{ width: 16, height: 2, borderRadius: 2, backgroundColor: focused ? p.accent : 'transparent' }} />
    </View>
  )
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
        tabBarLabelStyle: { fontSize: 11, fontWeight: '700' },
        // A fixed `height` overrides the safe-area inset, which is what pushed the labels down onto
        // the home indicator and made the bar look both too tall and too low (owner, 2026-08-06).
        // Height is the label plus the inset, and nothing else.
        tabBarStyle: {
          backgroundColor: p.bgElevated,
          borderTopColor: p.hairline,
          borderTopWidth: StyleSheet.hairlineWidth * 2,
          height: 44 + insets.bottom,
          paddingTop: 6,
          paddingBottom: insets.bottom,
        },
        tabBarItemStyle: { paddingTop: 0 },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Bugün', tabBarIcon: () => null, tabBarLabel: ({ focused }) => <TabLabel label="Bugün" focused={focused} /> }} />
      <Tabs.Screen name="agenda" options={{ title: 'Ajanda', tabBarIcon: () => null, tabBarLabel: ({ focused }) => <TabLabel label="Ajanda" focused={focused} /> }} />
      {/* The third tab is the member's own body and training, and its NAME depends on what she bought:
          a pilates-only member has no programme, so she must not meet the word "Antrenman" — not as a
          label, not as an empty state (owner, 2026-08-06). The answer comes from the server, never
          guessed here from her packages: a label guessed one way while the screen decides another is a
          tab that says "Antrenman" and opens on measurements. */}
      <Tabs.Screen
        name="training"
        options={{
          title: showPrograms ? 'Antrenman' : 'Ölçümlerim',
          tabBarIcon: () => null,
          tabBarLabel: ({ focused }) => <TabLabel label={showPrograms ? 'Antrenman' : 'Ölçümlerim'} focused={focused} />,
        }}
      />
      {/* Üyeliğim, Cüzdan, Mesajlar and Profil are one question — "ben neyim, nerede duruyorum" — so
          they are one screen. Nothing was removed; see app/(tabs)/profile.tsx. */}
      <Tabs.Screen name="profile" options={{ title: 'Ben', tabBarIcon: () => null, tabBarLabel: ({ focused }) => <TabLabel label="Ben" focused={focused} /> }} />
      {/* Kept as a route so every existing link still resolves, but off the bar: QR is reached from
          each screen's top-right, and Üyeliğim now lives inside Ben. */}
      <Tabs.Screen name="qr" options={{ href: null }} />
      <Tabs.Screen name="subscriptions" options={{ href: null }} />
    </Tabs>
  )
}
