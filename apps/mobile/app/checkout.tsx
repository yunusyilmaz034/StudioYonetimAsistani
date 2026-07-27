import { useState } from 'react'
import { View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { router, useLocalSearchParams } from 'expo-router'
import { WebView, type WebViewNavigation } from 'react-native-webview'

import { Body, Button, Loading } from '@/components/ui'
import { space, usePalette } from '@/theme'

// The PAYTR checkout, opened in-app.
//
// ── Knowing when it is over ─────────────────────────────────────────────────────────────────
//
// This used to watch only for OUR return URLs. PAYTR's LINK flow never reaches one: it finishes on
// its own "Ödeme Başarılı" page and stays there, so the member saw a green tick and a WebView that
// went nowhere — she had paid and the app pretended nothing had happened (owner, 2026-07-27).
//
// So the check now also recognises PAYTR's own end-of-flow pages. It stays URL-based rather than
// reading the page: a redirect is a fact, page text is a guess, and this must never announce a
// success that did not happen.
//
// WHAT THIS SCREEN DOES NOT DO: grant anything. The package comes from the signed server-to-server
// callback, which is the only thing that can be trusted — a card can still decline after the browser
// has moved on. That is why the wording is "alındı, tanımlanacak" and not "tanımlandı".

function outcomeFor(rawUrl: string): 'ok' | 'fail' | null {
  const u = rawUrl.toLowerCase()
  // Ours first — the iframe flow returns to these.
  if (u.includes('/payments/return') || u.includes('?ok') || u.includes('/portal')) return 'ok'
  if (u.includes('?fail') || u.includes('/payments/fail')) return 'fail'
  // PAYTR's own terminal pages (link flow). `basarili`/`success` and their failure twins.
  if (u.includes('paytr.com') && (u.includes('basarili') || u.includes('success') || u.includes('odeme-basarili'))) return 'ok'
  if (u.includes('paytr.com') && (u.includes('basarisiz') || u.includes('fail') || u.includes('hata'))) return 'fail'
  return null
}

export default function Checkout() {
  const p = usePalette()
  const { url, to } = useLocalSearchParams<{ url: string; to?: string }>()
  const [done, setDone] = useState<null | 'ok' | 'fail'>(null)

  // Where "devam" goes. A package purchase belongs back at her subscriptions — she just renewed and
  // that is the screen that answers "did it work?". A wallet top-up belongs at the wallet.
  const backTo = to === 'subscriptions' ? '/subscriptions' : '/wallet'

  function onNav(nav: WebViewNavigation) {
    const outcome = outcomeFor(nav.url)
    if (outcome) setDone(outcome)
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
      <View style={{ flex: 1, backgroundColor: p.bg, padding: space(6), justifyContent: 'center', alignItems: 'center', gap: space(4) }}>
        <Ionicons
          name={done === 'ok' ? 'checkmark-circle' : 'close-circle'}
          size={64}
          color={done === 'ok' ? p.good : p.danger}
        />
        <Body strong style={{ fontSize: 19, textAlign: 'center' }}>
          {done === 'ok' ? 'Ödemen alındı 🌸' : 'Ödeme tamamlanamadı'}
        </Body>
        <Body muted style={{ textAlign: 'center' }}>
          {done === 'ok'
            ? 'Paketin birkaç saniye içinde hesabına tanımlanacak. Aboneliklerinden kontrol edebilirsin.'
            : 'Kartından çekim yapılmadı. Dilersen tekrar deneyebilirsin.'}
        </Body>
        <Button
          label={done === 'ok' ? 'Aboneliklerime Dön' : 'Geri Dön'}
          onPress={() => router.replace(done === 'ok' ? backTo : '/subscriptions')}
        />
      </View>
    )
  }

  return (
    <WebView
      source={{ uri: url }}
      onNavigationStateChange={onNav}
      startInLoadingState
      renderLoading={() => <Loading />}
      style={{ flex: 1, backgroundColor: p.bg }}
    />
  )
}
