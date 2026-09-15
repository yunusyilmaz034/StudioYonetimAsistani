import { useState } from 'react'
import { Alert, RefreshControl, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'

import type { MemberReservation } from '@studio/core/client'
import { api } from '@/lib/api'
import { dateTime } from '@/lib/format'
import { useFetch } from '@/lib/useFetch'
import { FadeInUp, PressableScale } from '@/components/motion'
import { Loading, Screen } from '@/components/ui'
import { EmptyState, PremiumCard, SectionHeader, Txt } from '@/components/kit'
import { radius, space, typo as t, usePalette } from '@/theme'

export default function Reservations() {
  const p = usePalette()
  const { data, loading, reload } = useFetch(api.reservations)
  const [busyId, setBusyId] = useState<string | null>(null)
  if (loading && !data) return <Loading />

  function cancel(r: MemberReservation) {
    const hoursUntil = (r.startsAt - Date.now()) / 3_600_000
    // Inside the window the app explains and stops — it does not offer to spend her credit (OR-30).
    // The server refuses this too; the dialog is the courtesy, not the guard.
    if (hoursUntil <= r.cancellationWindowHours) {
      Alert.alert(
        'İptal süresi doldu',
        `Ders başlamasına ${r.cancellationWindowHours} saatten az kaldığı için bu rezervasyon uygulamadan iptal edilemez. Gelemeyecekseniz lütfen stüdyoyu arayın.`,
        [{ text: 'Tamam' }],
      )
      return
    }
    Alert.alert(`${r.serviceName} · ${dateTime(r.startsAt)}`, 'Rezervasyonun iptal edilsin mi?', [
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
      <SectionHeader>Yaklaşan</SectionHeader>
      {data && data.upcoming.length > 0 ? (
        data.upcoming.map((r, i) => (
          <FadeInUp key={r.reservationId} index={i}>
            <View style={{ marginBottom: space(3) }}>
              <PremiumCard>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(3) }}>
                  <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: p.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
                    <Ionicons name="barbell" size={20} color={p.primary} />
                  </View>
                  <View style={{ flex: 1, gap: space(1) }}>
                    <Txt role="h3" numberOfLines={1}>{r.serviceName}</Txt>
                    <Txt role="caption" tone="muted">{dateTime(r.startsAt)}</Txt>
                  </View>
                  <PressableScale onPress={() => cancel(r)}>
                    <View style={{ paddingHorizontal: space(3.5), paddingVertical: space(2), borderRadius: radius.pill, backgroundColor: p.errorSoft }}>
                      <Txt role="body" tone="error" style={t.button}>{busyId === r.reservationId ? '…' : 'İptal'}</Txt>
                    </View>
                  </PressableScale>
                </View>
              </PremiumCard>
            </View>
          </FadeInUp>
        ))
      ) : (
        <EmptyState icon="calendar-clear-outline" title="Yaklaşan rezervasyonun yok" body="Ajanda'dan uygun bir derse yer ayırtabilirsin." />
      )}

      {/* Geçmiş listesi üyeye gösterilmiyor (owner, 2026-09-15): sunucu `past` alanını boş döner. Bu ekranda
          "Geçmiş kaydın yok" demek yanlış olurdu — kayıt var, yalnızca üyeye gösterilmiyor. */}
    </Screen>
  )
}
