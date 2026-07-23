import { useEffect } from 'react'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { SafeAreaProvider } from 'react-native-safe-area-context'

import { AuthProvider } from '@/lib/auth'
import { trackError } from '@/lib/analytics'
import { usePalette } from '@/theme'

export default function RootLayout() {
  // The stack header is themed to the app's own palette — a white system bar on top of a dark screen
  // was the "beyaz nav bar" reported everywhere (Bildirimler / İletişim / Program / Bilgi düzenle …).
  const p = usePalette()
  // Global crash sink — chains the RN global error handler so a fatal JS error is reported (a no-op
  // until @react-native-firebase Crashlytics is wired; see lib/analytics.ts) without swallowing the
  // default red-box/crash behaviour.
  useEffect(() => {
    const g = globalThis as { ErrorUtils?: { getGlobalHandler?: () => unknown; setGlobalHandler?: (h: unknown) => void } }
    const eu = g.ErrorUtils
    if (!eu?.getGlobalHandler || !eu.setGlobalHandler) return
    const prev = eu.getGlobalHandler() as ((e: unknown, fatal?: boolean) => void) | undefined
    eu.setGlobalHandler((error: unknown, isFatal?: boolean) => {
      trackError(error, { where: 'global', fatal: Boolean(isFatal) })
      prev?.(error, isFatal)
    })
    return () => { if (prev) eu.setGlobalHandler?.(prev) }
  }, [])

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AuthProvider>
          <StatusBar style="auto" />
          <Stack
            screenOptions={{
              headerShown: false,
              animation: 'fade',
              headerBackButtonDisplayMode: 'minimal',
              headerShadowVisible: false,
              headerStyle: { backgroundColor: p.bg },
              headerTintColor: p.text,
              headerTitleStyle: { color: p.text, fontWeight: '700' },
              contentStyle: { backgroundColor: p.bg },
            }}
          >
            <Stack.Screen name="index" />
            <Stack.Screen name="login" />
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="reservations" options={{ headerShown: true, title: 'Rezervasyonlarım', presentation: 'card' }} />
            <Stack.Screen name="subscriptions" options={{ headerShown: true, title: 'Aboneliklerim' }} />
            <Stack.Screen name="messages" options={{ headerShown: true, title: 'Bildirimler' }} />
            <Stack.Screen name="checkout" options={{ headerShown: true, title: 'Güvenli Ödeme', presentation: 'modal' }} />
            <Stack.Screen name="program/[id]" options={{ headerShown: true, title: 'Program' }} />
            <Stack.Screen name="profile-edit" options={{ headerShown: true, title: 'Bilgilerimi Düzenle', presentation: 'modal' }} />
            <Stack.Screen name="contact" options={{ headerShown: true, title: 'İletişim' }} />
            <Stack.Screen name="banner" options={{ headerShown: true, title: '' }} />
          </Stack>
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}
