import { useState } from 'react'
import { Alert, RefreshControl, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'

import type { MemberReservation } from '@studio/core/client'
import { api } from '@/lib/api'
import { dateTime } from '@/lib/format'
import { useFetch } from '@/lib/useFetch'
import { FadeInUp, PressableScale } from '@/components/motion'
import { Body, Card, Empty, Eyebrow, Loading, Pill, Screen } from '@/components/ui'
import { radius, space, usePalette } from '@/theme'

export default function Reservations() {
  const p = usePalette()
  const { data, loading, reload } = useFetch(api.reservations)
  const [busyId, setBusyId] = useState<string | null>(null)
  if (loading && !data) return <Loading />

  function cancel(r: MemberReservation) {
    const hoursUntil = (r.startsAt - Date.now()) / 3_600_000
    const late = hoursUntil <= r.cancellationWindowHours && r.lateCancellationConsumesCredit
    Alert.alert(`${r.serviceName} · ${dateTime(r.startsAt)}`, late ? 'İptal penceresi içinde — geç iptal bir ders hakkını kullanır. İptal edilsin mi?' : 'Rezervasyonun iptal edilsin mi?', [
      { text: 'Vazgeç', style: 'cancel' },
      {
        text: 'İptal Et', style: 'destructive', onPress: async () => {
          setBusyId(r.reservationId)
          try { const res = await api.cancel(r.reservationId); if (res.ok) await reload(); else Alert.alert('İptal edilemedi', 'Tekrar dene.') }
          finally { setBusyId(null) }
        },
      },
    ])
  }

  return (
    <Screen header refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} tintColor={p.accent} />}>
      <Eyebrow>Yaklaşan</Eyebrow>
      {data && data.upcoming.length > 0 ? (
        data.upcoming.map((r, i) => (
          <FadeInUp key={r.reservationId} index={i}>
            <Card inset>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(3) }}>
                <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: p.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
                  <Ionicons name="barbell" size={20} color={p.accent} />
                </View>
                <View style={{ flex: 1 }}>
                  <Body strong numberOfLines={1}>{r.serviceName}</Body>
                  <Body muted style={{ fontSize: 13.5 }}>{dateTime(r.startsAt)}</Body>
                </View>
                <PressableScale onPress={() => cancel(r)}>
                  <View style={{ paddingHorizontal: space(3.5), paddingVertical: space(2), borderRadius: radius.pill, backgroundColor: p.dangerSoft }}>
                    <Body style={{ color: p.danger, fontWeight: '700', fontSize: 13.5 }}>{busyId === r.reservationId ? '…' : 'İptal'}</Body>
                  </View>
                </PressableScale>
              </View>
            </Card>
          </FadeInUp>
        ))
      ) : (
        <Card><Empty icon={<Ionicons name="calendar-clear-outline" size={30} color={p.textFaint} />} text="Yaklaşan rezervasyonun yok." /></Card>
      )}

      <Eyebrow>Geçmiş</Eyebrow>
      {data && data.past.length > 0 ? (
        data.past.slice(0, 20).map((r) => (
          <Card key={r.reservationId} inset style={{ opacity: 0.75 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <View>
                <Body strong numberOfLines={1}>{r.serviceName}</Body>
                <Body muted style={{ fontSize: 13.5 }}>{dateTime(r.startsAt)}</Body>
              </View>
              <Pill label={r.status === 'attended' ? 'Katıldı' : r.status === 'no_show' ? 'Gelmedi' : r.status} />
            </View>
          </Card>
        ))
      ) : (
        <Card><Empty icon={<Ionicons name="time-outline" size={28} color={p.textFaint} />} text="Geçmiş kaydın yok." /></Card>
      )}
    </Screen>
  )
}
