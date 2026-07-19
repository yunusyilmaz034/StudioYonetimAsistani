import { useEffect } from 'react'
import { Ionicons } from '@expo/vector-icons'
import * as Notifications from 'expo-notifications'
import { Redirect, router, Tabs } from 'expo-router'

import { useAuth } from '@/lib/auth'
import { registerForPush } from '@/lib/push'
import { Loading } from '@/components/ui'
import { usePalette } from '@/theme'

export default function TabsLayout() {
  const p = usePalette()
  const { user, loading } = useAuth()

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
      <Tabs.Screen name="index" options={{ title: 'Ana Sayfa', tabBarIcon: ({ color, size }) => <Ionicons name="home-outline" color={color} size={size} /> }} />
      <Tabs.Screen name="agenda" options={{ title: 'Ajanda', tabBarIcon: ({ color, size }) => <Ionicons name="calendar-outline" color={color} size={size} /> }} />
      <Tabs.Screen name="training" options={{ title: 'Antrenman', tabBarIcon: ({ color, size }) => <Ionicons name="barbell-outline" color={color} size={size} /> }} />
      <Tabs.Screen name="qr" options={{ title: 'QR', tabBarIcon: ({ color, size }) => <Ionicons name="qr-code-outline" color={color} size={size} /> }} />
      <Tabs.Screen name="profile" options={{ title: 'Profil', tabBarIcon: ({ color, size }) => <Ionicons name="person-outline" color={color} size={size} /> }} />
    </Tabs>
  )
}
