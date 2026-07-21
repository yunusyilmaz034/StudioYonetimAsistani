import { Image, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { router, useLocalSearchParams } from 'expo-router'

import { FadeInUp } from '@/components/motion'
import { Body, Button, Card, GradientFill, Screen } from '@/components/ui'
import { radius, shadow, space, typo as t, usePalette } from '@/theme'

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? ''

// The banner detail — reached by tapping a home banner. All content rides in query params (openBanner
// in the home screen), so no fetch is needed. Görsel + tam metin + iletişim.
export default function BannerDetail() {
  const p = usePalette()
  const params = useLocalSearchParams<{ title?: string; body?: string; detail?: string; image?: string; tone?: string }>()
  const title = first(params.title)
  const body = first(params.body)
  const detail = first(params.detail)
  const image = first(params.image)
  const tone = first(params.tone)
  const bg = tone === 'gold' ? p.gold : tone === 'good' ? p.good : p.accent

  return (
    <Screen header>
      <FadeInUp index={0}>
        {image ? (
          <View style={[{ borderRadius: radius.lg, overflow: 'hidden', minHeight: 200, justifyContent: 'flex-end' }, shadow(2)]}>
            <Image source={{ uri: image }} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} resizeMode="cover" />
            <GradientFill id="banner-detail" vertical from="#000000" to="#000000" fromOpacity={0.05} toOpacity={0.8} />
            <View style={{ padding: space(5) }}>
              <Body style={[t.display, { color: '#FFFFFF' }]}>{title}</Body>
            </View>
          </View>
        ) : (
          <View style={[{ borderRadius: radius.lg, overflow: 'hidden', backgroundColor: bg, padding: space(6), minHeight: 150, justifyContent: 'center' }, shadow(2)]}>
            <View style={{ position: 'absolute', top: -40, right: -20, width: 140, height: 140, borderRadius: 70, backgroundColor: '#FFFFFF', opacity: 0.12 }} />
            <Ionicons name="sparkles" size={26} color="#FFFFFF" style={{ marginBottom: space(2) }} />
            <Body style={[t.display, { color: '#FFFFFF' }]}>{title}</Body>
          </View>
        )}
      </FadeInUp>

      <FadeInUp index={1}>
        <Card>
          {body ? <Body strong style={{ fontSize: 16 }}>{body}</Body> : null}
          {detail ? <Body muted style={{ fontSize: 15, lineHeight: 23 }}>{detail}</Body> : null}
          {!body && !detail ? <Body muted>Bu duyuru için ek bilgi yok.</Body> : null}
        </Card>
      </FadeInUp>

      <FadeInUp index={2}>
        <Button
          label="İletişime Geç"
          icon={<Ionicons name="call-outline" size={18} color={p.accentText} />}
          onPress={() => router.push('/contact')}
        />
      </FadeInUp>
    </Screen>
  )
}
