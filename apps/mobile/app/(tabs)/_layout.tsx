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
  // A pilates-only member (no fitness/PT membership) has no workout programme — her "training" tab is
  // really just her measurements, so it reads "Ölçümler". Default to programmes while loading to avoid a
  // flash for gym members. The content itself is gated server-side (TrainingBundle.showPrograms).
  const subs = useFetch(api.subscriptions)
  const showPrograms = subs.data ? subs.data.active.some((s) => s.category === 'fitness' || s.category === 'private') : true

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
      <Tabs.Screen name="training" options={{ title: showPrograms ? 'Antrenman' : 'Ölçümler', tabBarIcon: ({ focused }) => <TabIcon filled={showPrograms ? 'barbell' : 'body'} outline={showPrograms ? 'barbell-outline' : 'body-outline'} focused={focused} /> }} />
      <Tabs.Screen name="qr" options={{ title: 'QR', tabBarIcon: ({ focused }) => <TabIcon filled="qr-code" outline="qr-code-outline" focused={focused} /> }} />
      <Tabs.Screen name="wallet" options={{ title: 'Cüzdan', tabBarIcon: ({ focused }) => <TabIcon filled="wallet" outline="wallet-outline" focused={focused} /> }} />
      <Tabs.Screen name="profile" options={{ title: 'Profil', tabBarIcon: ({ focused }) => <TabIcon filled="person" outline="person-outline" focused={focused} /> }} />
    </Tabs>
  )
}
