import { useState } from 'react'
import { Alert, RefreshControl } from 'react-native'

import type { MemberReservation } from '@studio/core/client'
import { api } from '@/lib/api'
import { dateTime } from '@/lib/format'
import { useFetch } from '@/lib/useFetch'
import { Body, Button, Card, Empty, H2, Loading, Pill, Screen } from '@/components/ui'
import { usePalette } from '@/theme'

export default function Reservations() {
  const p = usePalette()
  const { data, loading, reload } = useFetch(api.reservations)
  const [busyId, setBusyId] = useState<string | null>(null)
  if (loading && !data) return <Loading />

  async function cancel(r: MemberReservation) {
    Alert.alert('Rezervasyonu iptal et', `${r.serviceName} — ${dateTime(r.startsAt)}`, [
      { text: 'Vazgeç', style: 'cancel' },
      {
        text: 'İptal Et',
        style: 'destructive',
        onPress: async () => {
          setBusyId(r.reservationId)
          try {
            const res = await api.cancel(r.reservationId)
            if (res.ok) await reload()
            else Alert.alert('İptal edilemedi', res.error.code)
          } finally {
            setBusyId(null)
          }
        },
      },
    ])
  }

  return (
    <Screen refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} tintColor={p.accent} />}>
      <H2>Yaklaşan</H2>
      {data && data.upcoming.length > 0 ? (
        data.upcoming.map((r) => (
          <Card key={r.reservationId}>
            <Body>{r.serviceName}</Body>
            <Body muted>{dateTime(r.startsAt)}</Body>
            <Button label="İptal Et" tone="danger" onPress={() => cancel(r)} loading={busyId === r.reservationId} />
          </Card>
        ))
      ) : (
        <Empty text="Yaklaşan rezervasyonun yok." />
      )}

      <H2>Geçmiş</H2>
      {data && data.past.length > 0 ? (
        data.past.slice(0, 20).map((r) => (
          <Card key={r.reservationId}>
            <Body>{r.serviceName}</Body>
            <Body muted>{dateTime(r.startsAt)}</Body>
            <Pill label={r.status} />
          </Card>
        ))
      ) : (
        <Empty text="Geçmiş kaydın yok." />
      )}
    </Screen>
  )
}
