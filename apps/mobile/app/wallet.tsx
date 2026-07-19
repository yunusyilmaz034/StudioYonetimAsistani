import { useState } from 'react'
import { Alert, RefreshControl, View } from 'react-native'
import { router } from 'expo-router'

import type { MemberProduct } from '@/lib/api'
import { api } from '@/lib/api'
import { formatKurus } from '@/lib/format'
import { useFetch } from '@/lib/useFetch'
import { Body, Button, Card, Empty, H1, H2, Loading, Pill, Screen } from '@/components/ui'
import { space, usePalette } from '@/theme'

export default function Wallet() {
  const p = usePalette()
  const { data, loading, reload } = useFetch(api.wallet)
  const { data: products } = useFetch(api.products)
  const [busyId, setBusyId] = useState<string | null>(null)

  if (loading && !data) return <Loading />

  async function buy(prod: MemberProduct) {
    setBusyId(prod.id)
    try {
      const res = await api.purchase(prod.id)
      if (res.ok) {
        router.push({ pathname: '/checkout', params: { url: res.value.redirectUrl } })
      } else {
        Alert.alert('Ödeme başlatılamadı', 'Lütfen tekrar dene ya da stüdyoyla iletişime geç.')
      }
    } catch {
      Alert.alert('Hata', 'Ödeme başlatılamadı.')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <Screen header refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} tintColor={p.accent} />}>
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
            <Pill label={pk.remaining === null ? 'Sınırsız' : `${pk.remaining} ders`} tone="good" />
          </Card>
        ))
      ) : (
        <Empty text="Aktif paketin yok." />
      )}

      <H2>Paket Satın Al</H2>
      {products && products.length > 0 ? (
        products.map((prod) => (
          <Card key={prod.id}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Body>{prod.name}</Body>
              <Body>{formatKurus(prod.priceInKurus)}</Body>
            </View>
            <Button label="Satın Al" onPress={() => void buy(prod)} loading={busyId === prod.id} />
          </Card>
        ))
      ) : (
        <Empty text="Satın alınabilir paket bulunamadı." />
      )}

      {data && data.history.length > 0 ? (
        <>
          <H2>Ödeme Geçmişi</H2>
          {data.history.map((h) => (
            <Card key={h.id}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Body>{h.description}</Body>
                <Body>{formatKurus(h.amount)}</Body>
              </View>
              <Body muted>{h.method}</Body>
            </Card>
          ))}
        </>
      ) : null}
    </Screen>
  )
}
