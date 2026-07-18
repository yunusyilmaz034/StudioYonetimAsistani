import { RefreshControl, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { Link } from 'expo-router'

import { api } from '@/lib/api'
import { dateTime, formatKurus } from '@/lib/format'
import { useFetch } from '@/lib/useFetch'
import { Body, Card, Empty, H1, H2, Loading, Pill, Screen } from '@/components/ui'
import { space, usePalette } from '@/theme'

export default function Home() {
  const p = usePalette()
  const { data, loading, error, reload } = useFetch(api.dashboard)

  if (loading && !data) return <Loading />

  return (
    <Screen refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} tintColor={p.accent} />}>
      <H1>Merhaba{data ? `, ${data.memberName.split(' ')[0]}` : ''} 👋</H1>
      {error ? <Empty text="Bilgiler yüklenemedi. Aşağı çekip yenile." /> : null}

      <H2>Yaklaşan Derslerin</H2>
      {data && data.upcoming.length > 0 ? (
        data.upcoming.map((r) => (
          <Card key={r.reservationId}>
            <Body>{r.serviceName}</Body>
            <Body muted>{dateTime(r.startsAt)}</Body>
            <View style={{ flexDirection: 'row', gap: space(2) }}>
              {r.trainerName ? <Pill label={r.trainerName} /> : null}
              {r.roomName ? <Pill label={r.roomName} /> : null}
            </View>
          </Card>
        ))
      ) : (
        <Empty text="Yaklaşan dersin yok. Ajanda'dan yeni bir ders ayırt." />
      )}

      <H2>Paketlerin</H2>
      {data && data.packages.length > 0 ? (
        data.packages.map((pk) => (
          <Card key={pk.entitlementId}>
            <Body>{pk.productName}</Body>
            <View style={{ flexDirection: 'row', gap: space(2), alignItems: 'center' }}>
              <Pill label={pk.remaining === null ? 'Sınırsız' : `${pk.remaining} ders`} tone={pk.remaining !== null && pk.remaining <= 2 ? 'warn' : 'good'} />
              {pk.balanceDue > 0 ? <Pill label={`${formatKurus(pk.balanceDue)} borç`} tone="danger" /> : null}
            </View>
          </Card>
        ))
      ) : (
        <Empty text="Aktif paketin yok." />
      )}

      <View style={{ flexDirection: 'row', gap: space(3), flexWrap: 'wrap' }}>
        <QuickLink href="/reservations" icon="list-outline" label="Rezervasyonlarım" />
        <QuickLink href="/wallet" icon="wallet-outline" label="Cüzdan" />
        <QuickLink href="/messages" icon="notifications-outline" label="Bildirimler" />
      </View>
    </Screen>
  )
}

function QuickLink({ href, icon, label }: { href: '/reservations' | '/wallet' | '/messages'; icon: keyof typeof Ionicons.glyphMap; label: string }) {
  const p = usePalette()
  return (
    <Link href={href} asChild>
      <Card style={{ flexGrow: 1, minWidth: 150, alignItems: 'center' }}>
        <Ionicons name={icon} size={24} color={p.accent} />
        <Body>{label}</Body>
      </Card>
    </Link>
  )
}
