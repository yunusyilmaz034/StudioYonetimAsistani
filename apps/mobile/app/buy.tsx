import { useState } from 'react'
import { Alert, Pressable, RefreshControl, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { router } from 'expo-router'

import { api, type MemberProduct } from '@/lib/api'
import { formatKurus } from '@/lib/format'
import { track } from '@/lib/analytics'
import { useFetch } from '@/lib/useFetch'
import { FadeInUp } from '@/components/motion'
import { Body, Card, Empty, Loading, Pill, Screen } from '@/components/ui'
import { radius, space, usePalette } from '@/theme'

// PAKET YENİLEME — she renews without anyone phoning her (owner, 2026-07-27).
//
// This screen exists because of a number: the checklist now finds members whose credits have run out
// while their package is still valid, and there were five of them on the day it shipped. Finding them
// was never the hard part — reaching them was. Reception calls the next afternoon, the member has
// moved on, and the studio calls it "nobody's interested".
//
// So the loop closes here: the system spots it, a notification reaches her, and she renews at 22:00
// in three taps. No call, no cold conversation, no reception time.
//
// The catalogue is DATA (AD-41) and the studio decides what may be bought unattended
// (`onlineSellable`) — PT is off, because booking a trainer's hour is a conversation. Nothing about
// prices or packages is written in this file.
//
// PRICES ARE CARD PRICES. Paying here is paying by card, so the big number is what she will actually
// be charged and the cash price is shown underneath as an explanation rather than a footnote. A
// screen that advertises 4.200 and bills 4.620 loses a customer, not an argument.

const CATEGORY_TR: Record<string, string> = {
  pilates_group: 'Pilates',
  fitness: 'Fitness',
  private: 'Özel ders',
}

export default function Buy() {
  const p = usePalette()
  const { data, loading, reload } = useFetch(api.products)
  const [busy, setBusy] = useState<string | null>(null)

  async function buy(item: MemberProduct) {
    setBusy(item.id)
    try {
      const res = await api.purchase(item.id)
      if (res.ok) {
        track('payment_started', { method: 'package_purchase', amount_kurus: item.totalKurus })
        router.push({ pathname: '/checkout', params: { url: res.value.redirectUrl, to: 'subscriptions' } })
      } else {
        Alert.alert('Başlatılamadı', 'Ödeme başlatılamadı. Lütfen tekrar dene ya da stüdyoyla iletişime geç.')
      }
    } catch {
      Alert.alert('Hata', 'Ödeme başlatılamadı.')
    } finally {
      setBusy(null)
    }
  }

  if (loading && !data) return <Loading />
  const items = data ?? []

  return (
    <Screen header refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} tintColor={p.accent} />}>
      {items.length === 0 ? (
        <Card>
          <Empty
            icon={<Ionicons name="pricetag-outline" size={30} color={p.textFaint} />}
            text="Şu anda uygulamadan alınabilen bir paket yok. Stüdyoyla iletişime geçebilirsin."
          />
        </Card>
      ) : (
        items.map((item, i) => (
          <FadeInUp key={item.id} index={i}>
            <Card>
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space(2) }}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Body strong numberOfLines={2}>{item.name}</Body>
                  <Body muted style={{ fontSize: 13.5 }}>
                    {item.durationDays > 0 ? `${item.durationDays} gün geçerli` : 'Süresiz'}
                  </Body>
                </View>
                <Pill label={CATEGORY_TR[item.category] ?? item.category} tone="muted" />
              </View>

              <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: space(2) }}>
                <View>
                  <Body strong style={{ fontSize: 21 }}>{formatKurus(item.totalKurus)}</Body>
                  {/* Said out loud, not hidden: the number differs from the one on the wall because
                      this is a card payment. Discovering that at the bank is how trust goes. */}
                  {item.totalKurus !== item.cashKurus ? (
                    <Body faint style={{ fontSize: 12.5 }}>
                      kart ile · stüdyoda nakit {formatKurus(item.cashKurus)}
                    </Body>
                  ) : null}
                </View>
                <Pressable
                  disabled={busy !== null}
                  onPress={() => void buy(item)}
                  style={({ pressed }) => ({
                    opacity: pressed || busy === item.id ? 0.6 : busy ? 0.4 : 1,
                    backgroundColor: p.accent,
                    paddingHorizontal: space(5),
                    paddingVertical: space(3),
                    borderRadius: radius.pill,
                  })}
                >
                  <Body strong style={{ color: p.onGrad }}>
                    {busy === item.id ? 'Açılıyor…' : 'Satın al'}
                  </Body>
                </Pressable>
              </View>
            </Card>
          </FadeInUp>
        ))
      )}

      <Body faint style={{ fontSize: 12.5, textAlign: 'center', paddingHorizontal: space(4) }}>
        Ödeme, lisanslı ödeme kuruluşu üzerinden alınır. Paketin ödeme onaylanır onaylanmaz tanımlanır.
      </Body>
    </Screen>
  )
}
