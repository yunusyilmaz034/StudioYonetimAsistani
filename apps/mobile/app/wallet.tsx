import { RefreshControl, View } from 'react-native'

import { api } from '@/lib/api'
import { formatKurus } from '@/lib/format'
import { useFetch } from '@/lib/useFetch'
import { Body, Card, Empty, H1, H2, Loading, Pill, Screen } from '@/components/ui'
import { space, usePalette } from '@/theme'

export default function Wallet() {
  const p = usePalette()
  const { data, loading, reload } = useFetch(api.wallet)
  if (loading && !data) return <Loading />

  return (
    <Screen refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} tintColor={p.accent} />}>
      <Card>
        <H2>Bakiye</H2>
        <H1>{formatKurus(data?.balanceDue ?? 0)}</H1>
        <Body muted>{(data?.balanceDue ?? 0) > 0 ? 'Ödenecek tutar' : 'Borcun yok'}</Body>
      </Card>

      <H2>Paketlerim</H2>
      {data && data.packages.length > 0 ? (
        data.packages.map((pk) => (
          <Card key={pk.entitlementId}>
            <Body>{pk.productName}</Body>
            <View style={{ flexDirection: 'row', gap: space(2) }}>
              <Pill label={pk.remaining === null ? 'Sınırsız' : `${pk.remaining} ders`} tone="good" />
            </View>
          </Card>
        ))
      ) : (
        <Empty text="Aktif paketin yok." />
      )}

      {data && data.history.length > 0 ? (
        <>
          <H2>Ödeme Geçmişi</H2>
          {data.history.map((h) => (
            <Card key={h.id}>
              <Body>{formatKurus(h.amount)} · {h.method}</Body>
              <Body muted>{h.description}</Body>
            </Card>
          ))}
        </>
      ) : null}
    </Screen>
  )
}
