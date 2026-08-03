import { useEffect } from 'react'
import { View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import * as Notifications from 'expo-notifications'
import { Redirect, router, Tabs } from 'expo-router'

import { useAuth } from '@/lib/auth'
import { api } from '@/lib/api'
import { useFetch } from '@/lib/useFetch'
import { registerForPush } from '@/lib/push'
import { Loading } from '@/components/ui'
import { radius, usePalette } from '@/theme'

// The active tab reads as a filled icon sitting in a soft accent pill — the small, premium signature
// that separates a designed tab bar from the platform default.
function TabIcon({ filled, outline, focused }: { filled: keyof typeof Ionicons.glyphMap; outline: keyof typeof Ionicons.glyphMap; focused: boolean }) {
  const p = usePalette()
  return (
    <View style={{ width: 52, height: 32, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: focused ? p.accentSoft : 'transparent' }}>
      <Ionicons name={focused ? filled : outline} size={21} color={focused ? p.accent : p.textFaint} />
    </View>
  )
}

export default function TabsLayout() {
  const p = usePalette()
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
        tabBarStyle: {
          backgroundColor: p.bgElevated,
          borderTopColor: p.hairline,
          borderTopWidth: 1,
          height: 88,
          paddingTop: 8,
        },
        tabBarItemStyle: { paddingTop: 2 },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Ana Sayfa', tabBarIcon: ({ focused }) => <TabIcon filled="home" outline="home-outline" focused={focused} /> }} />
      <Tabs.Screen name="agenda" options={{ title: 'Ajanda', tabBarIcon: ({ focused }) => <TabIcon filled="calendar" outline="calendar-outline" focused={focused} /> }} />
      <Tabs.Screen name="training" options={{ title: showPrograms ? 'Antrenman' : 'Ölçümlerim', tabBarIcon: ({ focused }) => <TabIcon filled={showPrograms ? 'barbell' : 'body'} outline={showPrograms ? 'barbell-outline' : 'body-outline'} focused={focused} /> }} />
      <Tabs.Screen name="qr" options={{ title: 'QR', tabBarIcon: ({ focused }) => <TabIcon filled="qr-code" outline="qr-code-outline" focused={focused} /> }} />
      {/* PF-42 (owner, 2026-07-29) — Üyeliğim took the wallet's place, and the reason is measured:
          production has ZERO wallets, not one member has ever had one, while every member holds a
          package and the renewal flow that earns money sat two taps deep behind a card on the home
          screen. The unused feature was in the window and the selling one in the stockroom.
          The wallet is not gone — it moved to Profile, and comes back here the day stored value is
          actually sold. A SEVENTH tab was refused: at 375 px that leaves ~53 px each and the labels
          truncate. */}
      <Tabs.Screen name="subscriptions" options={{ title: 'Üyeliğim', tabBarIcon: ({ focused }) => <TabIcon filled="ticket" outline="ticket-outline" focused={focused} /> }} />
      <Tabs.Screen name="profile" options={{ title: 'Profil', tabBarIcon: ({ focused }) => <TabIcon filled="person" outline="person-outline" focused={focused} /> }} />
    </Tabs>
  )
}
