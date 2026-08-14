import { Alert, Linking, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'

import { api } from '@/lib/api'
import { useFetch } from '@/lib/useFetch'
import { FadeInUp } from '@/components/motion'
import { Body, Hero, Loading, Screen } from '@/components/ui'
import { EmptyState, PremiumCard, SectionHeader, Txt } from '@/components/kit'
import { radius, space, typo as t, usePalette } from '@/theme'

// Turn a stored phone (E.164 `+90…` or a local `0…`) into the digits wa.me / tel: want.
function phoneDigits(phone: string): string {
  const d = phone.replace(/\D/g, '')
  if (d.startsWith('90')) return d
  if (d.startsWith('0')) return `90${d.slice(1)}`
  return d
}

async function open(url: string) {
  try {
    await Linking.openURL(url)
  } catch {
    Alert.alert('Açılamadı', 'Bu işlem bu cihazda yapılamıyor.')
  }
}

export default function Contact() {
  const p = usePalette()
  const { data, loading } = useFetch(api.contact)

  if (loading && !data) return <Loading />

  const c = data
  const digits = c?.phone ? phoneDigits(c.phone) : ''
  const rows: { icon: keyof typeof Ionicons.glyphMap; label: string; value: string; onPress: () => void; tint?: string }[] = []
  if (c?.phone) rows.push({ icon: 'call-outline', label: 'Telefon', value: c.phone, onPress: () => void open(`tel:${digits}`) })
  if (digits) rows.push({ icon: 'logo-whatsapp', label: 'WhatsApp', value: 'Mesaj gönder', onPress: () => void open(`https://wa.me/${digits}`), tint: '#25D366' })
  if (c?.email) rows.push({ icon: 'mail-outline', label: 'E-posta', value: c.email, onPress: () => void open(`mailto:${c.email}`) })
  if (c?.address) rows.push({ icon: 'location-outline', label: 'Adres', value: c.address, onPress: () => void open(c.mapsUrl || `https://maps.google.com/?q=${encodeURIComponent(c.address)}`) })
  if (c?.website) rows.push({ icon: 'globe-outline', label: 'Web sitesi', value: c.website.replace(/^https?:\/\//, ''), onPress: () => void open(c.website!) })

  return (
    <Screen header>
      <FadeInUp index={0}>
        <Hero>
          <Body style={[t.label, { color: p.onGradMuted }]}>İLETİŞİM</Body>
          <Body style={[t.display, { color: p.onGrad }]} numberOfLines={2}>{c?.name || 'Stüdyo'}</Body>
          {c?.phone ? <Body style={{ color: p.onGradMuted }}>{c.phone}</Body> : null}
        </Hero>
      </FadeInUp>

      {rows.length === 0 ? (
        <FadeInUp index={1}>
          <EmptyState icon="call-outline" title="İletişim bilgileri henüz eklenmemiş" body="Stüdyo bilgilerini eklediğinde burada görünür." />
        </FadeInUp>
      ) : (
        <FadeInUp index={1}>
          <SectionHeader>Bize ulaş</SectionHeader>
          <View style={{ gap: space(3) }}>
            {rows.map((r) => (
              <PremiumCard key={r.label} onPress={r.onPress}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(3.5) }}>
                  <View style={{ width: 44, height: 44, borderRadius: radius.sm, backgroundColor: (r.tint ?? p.primary) + '18', alignItems: 'center', justifyContent: 'center' }}>
                    <Ionicons name={r.icon} size={21} color={r.tint ?? p.primary} />
                  </View>
                  <View style={{ flex: 1, gap: space(1) }}>
                    <Txt role="caption" tone="muted">{r.label}</Txt>
                    <Txt role="h3" numberOfLines={2}>{r.value}</Txt>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={p.textMuted} />
                </View>
              </PremiumCard>
            ))}
          </View>
        </FadeInUp>
      )}
    </Screen>
  )
}
