import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { SafeAreaProvider } from 'react-native-safe-area-context'

import { AuthProvider } from '@/lib/auth'

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AuthProvider>
          <StatusBar style="auto" />
          <Stack screenOptions={{ headerShown: false, animation: 'fade' }}>
            <Stack.Screen name="index" />
            <Stack.Screen name="login" />
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="reservations" options={{ headerShown: true, title: 'Rezervasyonlarım', presentation: 'card' }} />
            <Stack.Screen name="wallet" options={{ headerShown: true, title: 'Cüzdan' }} />
            <Stack.Screen name="messages" options={{ headerShown: true, title: 'Bildirimler' }} />
            <Stack.Screen name="checkout" options={{ headerShown: true, title: 'Güvenli Ödeme', presentation: 'modal' }} />
          </Stack>
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}
