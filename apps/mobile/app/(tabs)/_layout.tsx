import { Ionicons } from '@expo/vector-icons'
import { Redirect, Tabs } from 'expo-router'

import { useAuth } from '@/lib/auth'
import { Loading } from '@/components/ui'
import { usePalette } from '@/theme'

export default function TabsLayout() {
  const p = usePalette()
  const { user, loading } = useAuth()
  if (loading) return <Loading />
  if (!user) return <Redirect href="/login" />

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: p.accent,
        tabBarInactiveTintColor: p.textMuted,
        tabBarStyle: { backgroundColor: p.surface, borderTopColor: p.border },
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
