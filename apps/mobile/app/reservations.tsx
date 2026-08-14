import { useState } from 'react'
import { Alert, Pressable, RefreshControl, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'

import type { MemberReservation } from '@studio/core/client'
import { api } from '@/lib/api'
import { dateTime } from '@/lib/format'
import { useFetch } from '@/lib/useFetch'
import { FadeInUp, PressableScale } from '@/components/motion'
import { Loading, Screen } from '@/components/ui'
import { EmptyState, PremiumCard, SectionHeader, StatusChip, Txt } from '@/components/kit'
import { radius, space, typo as t, usePalette } from '@/theme'

const STATUS_TR: Record<string, string> = {
  attended: 'Katıldı',
  presumed_attended: 'Katıldı',
  auto_resolved: 'Katıldı',
  no_show: 'Gelmedi',
  cancelled: 'İptal edildi',
  late_cancelled: 'İptal edildi', // OR-30 — the member never meets the studio's accounting word
  booked: 'Rezerve',
}

export default function Reservations() {
  const p = usePalette()
  const { data, loading, reload } = useFetch(api.reservations)
  const [busyId, setBusyId] = useState<string | null>(null)
  // Closed on open: the past is a record, not a decision (PF-43).
  const [pastOpen, setPastOpen] = useState(false)
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

      {/* PF-43 (owner, 2026-07-29) — the past is COLLAPSED by default.
          An active reservation is a decision (I am there on Tuesday); a past one is a record.
          Listing them together made the member sort one from the other on every open, and she said
          so. The table is unchanged — it is only wrapped, and the count is on the header so nothing
          feels hidden. */}
      {data && data.past.length > 0 ? (
        <Pressable onPress={() => setPastOpen((v) => !v)} hitSlop={8}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(2), paddingVertical: space(2) }}>
            <SectionHeader>{`Geçmiş (${data.past.length})`}</SectionHeader>
            <Ionicons name={pastOpen ? 'chevron-up' : 'chevron-down'} size={16} color={p.textMuted} />
          </View>
        </Pressable>
      ) : (
        <SectionHeader>Geçmiş</SectionHeader>
      )}
      {data && data.past.length > 0 && pastOpen ? (
        data.past.slice(0, 20).map((r) => (
          <View key={r.reservationId} style={{ marginBottom: space(2), opacity: 0.8 }}>
            <PremiumCard>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space(3) }}>
                <View style={{ flex: 1, gap: space(1) }}>
                  <Txt role="h3" numberOfLines={1}>{r.serviceName}</Txt>
                  <Txt role="caption" tone="muted">{dateTime(r.startsAt)}</Txt>
                </View>
                <StatusChip
                  label={STATUS_TR[r.status] ?? 'Kayıt'}
                  tone={r.status === 'no_show' ? 'warning' : r.status.includes('cancel') ? 'neutral' : 'success'}
                />
              </View>
            </PremiumCard>
          </View>
        ))
      ) : data && data.past.length === 0 ? (
        <EmptyState icon="time-outline" title="Geçmiş kaydın yok" body="Katıldığın dersler burada birikir." />
      ) : null}
    </Screen>
  )
}
