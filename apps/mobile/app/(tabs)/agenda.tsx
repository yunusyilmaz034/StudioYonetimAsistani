import { useMemo, useState } from 'react'
import { Alert, ScrollView, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { SafeAreaView } from 'react-native-safe-area-context'

import type { MemberReservation, MemberSession } from '@studio/core/client'
import { api } from '@/lib/api'
import { useFetch } from '@/lib/useFetch'
import { FadeInUp, PressableScale } from '@/components/motion'
import { Body, Button, Card, Empty, Loading, Pill, Title } from '@/components/ui'
import { radius, shadow, space, usePalette } from '@/theme'

const BLOCKED_TR: Record<string, string> = { full: 'Kontenjan dolu', no_credit: 'Uygun paket/kredi yok', self_booking_off: 'Online rezervasyona kapalı', past: 'Geçmiş' }
const dayKey = (ms: number) => new Date(ms).toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit' })
const WD = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt']
const hhmm = (ms: number) => new Date(ms).toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' })

export default function Agenda() {
  const p = usePalette()
  const agenda = useFetch(api.agenda)
  const reservations = useFetch(api.reservations)
  const [sel, setSel] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  // sessionId → her upcoming reservation (so a booked class in the agenda can be cancelled here).
  const resBySession = useMemo(() => {
    const m = new Map<string, MemberReservation>()
    for (const r of reservations.data?.upcoming ?? []) m.set(r.sessionId, r)
    return m
  }, [reservations.data])

  const days = useMemo(() => {
    const map = new Map<string, { key: string; ms: number }>()
    for (const s of agenda.data?.sessions ?? []) {
      const k = dayKey(s.startsAt)
      if (!map.has(k)) map.set(k, { key: k, ms: s.startsAt })
    }
    return [...map.values()].sort((a, b) => a.ms - b.ms)
  }, [agenda.data])

  const active = sel ?? days[0]?.key ?? null
  const daySessions = (agenda.data?.sessions ?? []).filter((s) => dayKey(s.startsAt) === active).sort((a, b) => a.startsAt - b.startsAt)

  if (agenda.loading && !agenda.data) return <Loading />

  const reload = () => { void agenda.reload(); void reservations.reload() }

  async function book(s: MemberSession) {
    setBusyId(s.sessionId)
    try {
      const res = await api.book(s.sessionId)
      if (res.ok) { Alert.alert('Rezervasyon alındı ✓', `${s.serviceName} — ${hhmm(s.startsAt)}`); reload() }
      else Alert.alert('Rezervasyon yapılamadı', BLOCKED_TR[res.error.code] ?? res.error.code)
    } catch { Alert.alert('Hata', 'Rezervasyon yapılamadı, tekrar dene.') } finally { setBusyId(null) }
  }

  function askCancel(s: MemberSession, r: MemberReservation) {
    const hoursUntil = (s.startsAt - Date.now()) / 3_600_000
    const late = hoursUntil <= r.cancellationWindowHours
    const warn = late && r.lateCancellationConsumesCredit
      ? `Bu ders ${r.cancellationWindowHours} saatlik iptal penceresi içinde — geç iptal bir ders hakkını kullanır. Yine de iptal edilsin mi?`
      : 'Rezervasyonun iptal edilsin mi?'
    Alert.alert(`${s.serviceName} · ${hhmm(s.startsAt)}`, warn, [
      { text: 'Vazgeç', style: 'cancel' },
      {
        text: 'İptal Et', style: 'destructive', onPress: async () => {
          setBusyId(s.sessionId)
          try {
            const res = await api.cancel(r.reservationId)
            if (res.ok) { Alert.alert('İptal edildi'); reload() } else Alert.alert('İptal edilemedi', 'Tekrar dene.')
          } catch { Alert.alert('Hata', 'İptal edilemedi.') } finally { setBusyId(null) }
        },
      },
    ])
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: p.bg }} edges={['top']}>
      <View style={{ paddingHorizontal: space(5), paddingTop: space(2) }}>
        <Title sub="Derslerini seç ve yerini ayırt">Ajanda</Title>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: space(5), gap: space(2.5), paddingTop: space(2), paddingBottom: space(3) }} style={{ flexGrow: 0, marginBottom: space(2) }}>
        {days.map((d) => {
          const on = d.key === active
          const dt = new Date(d.ms)
          return (
            <PressableScale key={d.key} onPress={() => setSel(d.key)}>
              <View style={[{ width: 60, paddingVertical: space(2.5), borderRadius: radius.lg, alignItems: 'center', gap: 3, backgroundColor: on ? p.accent : p.surface, borderWidth: 1, borderColor: on ? p.accent : p.hairline }, on ? shadow(1) : null]}>
                <Body style={{ fontSize: 12, fontWeight: '700', color: on ? p.onGradMuted : p.textMuted }}>{WD[dt.getDay()]}</Body>
                <Body style={{ fontSize: 22, fontWeight: '800', color: on ? p.onGrad : p.text }}>{dt.getDate()}</Body>
                <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: on ? p.onGrad : p.accent }} />
              </View>
            </PressableScale>
          )
        })}
      </ScrollView>

      <ScrollView contentContainerStyle={{ paddingHorizontal: space(5), paddingBottom: space(10), gap: space(3) }} showsVerticalScrollIndicator={false}>
        {daySessions.length === 0 ? (
          <Card><Empty icon={<Ionicons name="calendar-clear-outline" size={30} color={p.textFaint} />} text="Bu gün için sana uygun ders yok." /></Card>
        ) : (
          daySessions.map((s, i) => {
            const res = resBySession.get(s.sessionId)
            return (
              <FadeInUp key={s.sessionId} index={i}>
                <Card inset>
                  <View style={{ flexDirection: 'row', gap: space(3.5), alignItems: 'center' }}>
                    <View style={{ alignItems: 'center', minWidth: 54 }}>
                      <Body style={{ fontSize: 19, fontWeight: '800', color: p.accent }}>{hhmm(s.startsAt)}</Body>
                      <Body faint style={{ fontSize: 11 }}>{s.bookedCount}/{s.capacity}</Body>
                    </View>
                    <View style={{ width: 1, alignSelf: 'stretch', backgroundColor: p.hairline }} />
                    <View style={{ flex: 1, gap: 5 }}>
                      <Body strong numberOfLines={1}>{s.serviceName}</Body>
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space(1.5) }}>
                        {s.trainerName ? <Pill label={s.trainerName} /> : null}
                        {s.roomName ? <Pill label={s.roomName} /> : null}
                      </View>
                      {s.alreadyBooked ? <Pill label="Rezervasyonun var ✓" tone="good" /> : s.blockedReason ? <Pill label={BLOCKED_TR[s.blockedReason] ?? 'Kapalı'} tone="warn" /> : null}
                    </View>
                    {s.alreadyBooked && res ? (
                      <View style={{ minWidth: 92 }}>
                        <Button label="İptal" tone="danger" onPress={() => askCancel(s, res)} loading={busyId === s.sessionId} />
                      </View>
                    ) : !s.alreadyBooked && !s.blockedReason ? (
                      <View style={{ minWidth: 96 }}>
                        <Button label="Rezerve" onPress={() => void book(s)} loading={busyId === s.sessionId} />
                      </View>
                    ) : null}
                  </View>
                </Card>
              </FadeInUp>
            )
          })
        )}
      </ScrollView>
    </SafeAreaView>
  )
}
