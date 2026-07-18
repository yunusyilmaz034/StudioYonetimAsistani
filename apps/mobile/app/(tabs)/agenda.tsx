import { useState } from 'react'
import { Alert, RefreshControl, View } from 'react-native'

import type { MemberSession } from '@studio/core/client'
import { api } from '@/lib/api'
import { dateTime } from '@/lib/format'
import { useFetch } from '@/lib/useFetch'
import { Body, Button, Card, Empty, H1, Loading, Pill, Screen } from '@/components/ui'
import { space, usePalette } from '@/theme'

const BLOCKED_TR: Record<string, string> = {
  full: 'Kontenjan dolu',
  no_credit: 'Uygun paket/kredi yok',
  self_booking_off: 'Bu ders online rezervasyona kapalı',
  past: 'Geçmiş ders',
}

export default function Agenda() {
  const p = usePalette()
  const { data, loading, reload } = useFetch(api.agenda)
  const [busyId, setBusyId] = useState<string | null>(null)

  if (loading && !data) return <Loading />

  async function book(s: MemberSession) {
    setBusyId(s.sessionId)
    try {
      const res = await api.book(s.sessionId)
      if (res.ok) {
        Alert.alert('Rezervasyon alındı', `${s.serviceName} — ${dateTime(s.startsAt)}`)
        await reload()
      } else {
        Alert.alert('Rezervasyon yapılamadı', res.error.code)
      }
    } catch {
      Alert.alert('Hata', 'Rezervasyon yapılamadı, tekrar dene.')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <Screen refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} tintColor={p.accent} />}>
      <H1>Ajanda</H1>
      {!data || data.sessions.length === 0 ? (
        <Empty text="Önümüzdeki günlerde sana uygun ders görünmüyor." />
      ) : (
        data.sessions.map((s) => (
          <Card key={s.sessionId}>
            <Body>{s.serviceName}</Body>
            <Body muted>{dateTime(s.startsAt)}</Body>
            <View style={{ flexDirection: 'row', gap: space(2), flexWrap: 'wrap' }}>
              {s.trainerName ? <Pill label={s.trainerName} /> : null}
              {s.roomName ? <Pill label={s.roomName} /> : null}
              <Pill label={`${s.bookedCount}/${s.capacity}`} tone={s.bookedCount >= s.capacity ? 'warn' : 'muted'} />
            </View>
            {s.alreadyBooked ? (
              <Pill label="Rezervasyonun var" tone="good" />
            ) : s.blockedReason ? (
              <Pill label={BLOCKED_TR[s.blockedReason] ?? 'Rezerve edilemez'} tone="warn" />
            ) : (
              <Button label="Rezerve Et" onPress={() => void book(s)} loading={busyId === s.sessionId} />
            )}
          </Card>
        ))
      )}
    </Screen>
  )
}
