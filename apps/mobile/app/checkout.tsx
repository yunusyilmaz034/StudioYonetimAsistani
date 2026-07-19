import { useState } from 'react'
import { View } from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import { WebView, type WebViewNavigation } from 'react-native-webview'

import { Body, Button, Loading } from '@/components/ui'
import { space, usePalette } from '@/theme'

// The PAYTR checkout, opened in-app. When PAYTR returns to the success/fail URL we close the WebView;
// the package is granted server-side by the verified callback, so the wallet just needs a refresh.
export default function Checkout() {
  const p = usePalette()
  const { url } = useLocalSearchParams<{ url: string }>()
  const [done, setDone] = useState<null | 'ok' | 'fail'>(null)

  function onNav(nav: WebViewNavigation) {
    const u = nav.url
    if (u.includes('/payments/return') || u.includes('?ok') || u.includes('/portal')) setDone('ok')
    else if (u.includes('?fail') || u.includes('/payments/fail')) setDone('fail')
  }

  if (!url) {
    return (
      <View style={{ flex: 1, backgroundColor: p.bg, padding: space(6), justifyContent: 'center', gap: space(4) }}>
        <Body>Ödeme sayfası açılamadı.</Body>
        <Button label="Geri Dön" onPress={() => router.back()} />
      </View>
    )
  }

  if (done) {
    return (
      <View style={{ flex: 1, backgroundColor: p.bg, padding: space(6), justifyContent: 'center', gap: space(4) }}>
        <Body>{done === 'ok' ? 'Ödemen alındı. Paketin kısa süre içinde hesabına tanımlanacak.' : 'Ödeme tamamlanamadı. Tekrar deneyebilirsin.'}</Body>
        <Button label="Cüzdana Dön" onPress={() => router.replace('/wallet')} />
      </View>
    )
  }

  return <WebView source={{ uri: url }} onNavigationStateChange={onNav} startInLoadingState renderLoading={() => <Loading />} style={{ flex: 1, backgroundColor: p.bg }} />
}
