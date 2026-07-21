import { useMemo, useState } from 'react'
import { Alert, RefreshControl, ScrollView, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { SafeAreaView } from 'react-native-safe-area-context'

import type { MemberReservation, MemberSession } from '@studio/core/client'
import { api } from '@/lib/api'
import { useFetch } from '@/lib/useFetch'
import { FadeInUp, PressableScale } from '@/components/motion'
import { Body, Card, Empty, Pill, ScreenSkeleton, Title } from '@/components/ui'
import { radius, shadow, space, usePalette } from '@/theme'

function ActionPill({ label, tone, busy, onPress }: { label: string; tone: 'accent' | 'danger'; busy: boolean; onPress: () => void }) {
  const p = usePalette()
  const c = tone === 'danger' ? p.danger : p.accent
  const bg = tone === 'danger' ? p.dangerSoft : p.accent
  const fg = tone === 'danger' ? p.danger : p.accentText
  return (
    <PressableScale onPress={onPress}>
      <View style={{ paddingHorizontal: space(3.5), paddingVertical: space(2), borderRadius: radius.pill, backgroundColor: bg, borderWidth: tone === 'danger' ? 1 : 0, borderColor: c + '30', minWidth: 72, alignItems: 'center' }}>
        <Body style={{ color: fg, fontWeight: '700', fontSize: 13.5 }}>{busy ? '…' : label}</Body>
      </View>
    </PressableScale>
  )
}

const BLOCKED_TR: Record<string, string> = { full: 'Kontenjan dolu', no_credit: 'Uygun paket/kredi yok', self_booking_off: 'Online rezervasyona kapalı', past: 'Geçmiş' }
// Past-reservation outcomes → a Turkish label + a tone. Falls back to the raw status if a new one appears.
const STATUS_TR: Record<string, { label: string; tone: 'good' | 'danger' | 'warn' | 'muted' }> = {
  attended: { label: 'Katıldın', tone: 'good' },
  auto_resolved: { label: 'Katıldın', tone: 'good' },
  presumed_attended: { label: 'Katıldın', tone: 'good' },
  no_show: { label: 'Gelmedin', tone: 'danger' },
  late_cancelled: { label: 'Geç iptal', tone: 'warn' },
  cancelled: { label: 'İptal edildi', tone: 'muted' },
}

const dayKey = (ms: number) => new Date(ms).toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit' })
const WD = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt']
const hhmm = (ms: number) => new Date(ms).toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' })
const longDay = (ms: number) => new Date(ms).toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul', weekday: 'short', day: 'numeric', month: 'short' })

// "Bugün" / "Yarın" / "Sal 22 Tem" — a warm relative label for the reservations list.
function relDay(ms: number): string {
  const today = dayKey(Date.now())
  const tomorrow = dayKey(Date.now() + 86_400_000)
  const k = dayKey(ms)
  if (k === today) return 'Bugün'
  if (k === tomorrow) return 'Yarın'
  return longDay(ms)
}

type Tab = 'book' | 'mine'

export default function Agenda() {
  const p = usePalette()
  const agenda = useFetch(api.agenda)
  const reservations = useFetch(api.reservations)
  const [tab, setTab] = useState<Tab>('book')
  const [sel, setSel] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  // sessionId → her upcoming reservation (so a booked class in the browse view can be cancelled there).
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
  const upcoming = [...(reservations.data?.upcoming ?? [])].sort((a, b) => a.startsAt - b.startsAt)
  const past = [...(reservations.data?.past ?? [])].sort((a, b) => b.startsAt - a.startsAt)

  if (agenda.loading && !agenda.data) return <ScreenSkeleton hero={false} />

  const refreshing = (agenda.loading || reservations.loading) && !!agenda.data
  const reload = () => { void agenda.reload(); void reservations.reload() }

  async function book(s: MemberSession) {
    setBusyId(s.sessionId)
    try {
      const res = await api.book(s.sessionId)
      if (res.ok) { Alert.alert('Rezervasyon alındı ✓', `${s.serviceName} — ${hhmm(s.startsAt)}`); reload() }
      else Alert.alert('Rezervasyon yapılamadı', BLOCKED_TR[res.error.code] ?? res.error.code)
    } catch { Alert.alert('Hata', 'Rezervasyon yapılamadı, tekrar dene.') } finally { setBusyId(null) }
  }

  // Cancel works off the reservation alone — everything the warning needs (start time, window, whether a
  // late cancel burns a credit) rides on MemberReservation, so both tabs call the same path.
  function askCancel(r: MemberReservation) {
    const hoursUntil = (r.startsAt - Date.now()) / 3_600_000
    const late = hoursUntil <= r.cancellationWindowHours
    const warn = late && r.lateCancellationConsumesCredit
      ? `Bu ders ${r.cancellationWindowHours} saatlik iptal penceresi içinde — geç iptal bir ders hakkını kullanır. Yine de iptal edilsin mi?`
      : 'Rezervasyonun iptal edilsin mi?'
    Alert.alert(`${r.serviceName} · ${hhmm(r.startsAt)}`, warn, [
      { text: 'Vazgeç', style: 'cancel' },
      {
        text: 'İptal Et', style: 'destructive', onPress: async () => {
          setBusyId(r.sessionId)
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
      <View style={{ paddingHorizontal: space(5), paddingTop: space(2), paddingBottom: space(3) }}>
        <Title sub={tab === 'book' ? 'Uygun dersleri gör ve yerini ayırt' : 'Yaklaşan ve geçmiş rezervasyonların'}>Ajanda</Title>

        {/* The two sections, as a segmented control — booking vs. my reservations. */}
        <View style={{ flexDirection: 'row', backgroundColor: p.surfaceMuted, borderRadius: radius.pill, padding: 4, marginTop: space(3) }}>
          <Segment label="Rezervasyon Yap" on={tab === 'book'} onPress={() => setTab('book')} />
          <Segment label="Rezervasyonlarım" on={tab === 'mine'} onPress={() => setTab('mine')} badge={upcoming.length || undefined} />
        </View>
      </View>

      {tab === 'book' ? (
        <>
          {days.length > 0 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: space(5), gap: space(2.5), paddingTop: space(1), paddingBottom: space(4) }} style={{ flexGrow: 0, marginBottom: space(1) }}>
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
          ) : null}

          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingHorizontal: space(5), paddingTop: space(1), paddingBottom: space(10), gap: space(3) }}
            showsVerticalScrollIndicator={false}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={reload} tintColor={p.accent} />}
          >
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
                          <ActionPill label="İptal" tone="danger" busy={busyId === s.sessionId} onPress={() => askCancel(res)} />
                        ) : !s.alreadyBooked && !s.blockedReason ? (
                          <ActionPill label="Rezerve" tone="accent" busy={busyId === s.sessionId} onPress={() => void book(s)} />
                        ) : null}
                      </View>
                    </Card>
                  </FadeInUp>
                )
              })
            )}
          </ScrollView>
        </>
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingHorizontal: space(5), paddingTop: space(1), paddingBottom: space(10), gap: space(3) }}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={reload} tintColor={p.accent} />}
        >
          {upcoming.length === 0 && past.length === 0 ? (
            <Card><Empty icon={<Ionicons name="bookmark-outline" size={30} color={p.textFaint} />} text="Henüz rezervasyonun yok. “Rezervasyon Yap” sekmesinden yerini ayırt." /></Card>
          ) : null}

          {upcoming.length > 0 ? (
            <>
              <SectionLabel>Yaklaşan</SectionLabel>
              {upcoming.map((r, i) => (
                <FadeInUp key={r.reservationId} index={i}>
                  <Card inset>
                    <View style={{ flexDirection: 'row', gap: space(3.5), alignItems: 'center' }}>
                      <View style={{ alignItems: 'center', minWidth: 62 }}>
                        <Body style={{ fontSize: 12, fontWeight: '700', color: p.textMuted }}>{relDay(r.startsAt)}</Body>
                        <Body style={{ fontSize: 19, fontWeight: '800', color: p.accent }}>{hhmm(r.startsAt)}</Body>
                      </View>
                      <View style={{ width: 1, alignSelf: 'stretch', backgroundColor: p.hairline }} />
                      <View style={{ flex: 1, gap: 5 }}>
                        <Body strong numberOfLines={1}>{r.serviceName}</Body>
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space(1.5) }}>
                          {r.trainerName ? <Pill label={r.trainerName} /> : null}
                          {r.roomName ? <Pill label={r.roomName} /> : null}
                        </View>
                      </View>
                      <ActionPill label="İptal" tone="danger" busy={busyId === r.sessionId} onPress={() => askCancel(r)} />
                    </View>
                  </Card>
                </FadeInUp>
              ))}
            </>
          ) : null}

          {past.length > 0 ? (
            <>
              <SectionLabel>Geçmiş</SectionLabel>
              {past.map((r, i) => {
                const st = STATUS_TR[r.status]
                return (
                  <FadeInUp key={r.reservationId} index={i}>
                    <Card inset style={{ opacity: 0.9 }}>
                      <View style={{ flexDirection: 'row', gap: space(3.5), alignItems: 'center' }}>
                        <View style={{ alignItems: 'center', minWidth: 62 }}>
                          <Body faint style={{ fontSize: 12, fontWeight: '700' }}>{longDay(r.startsAt)}</Body>
                          <Body muted style={{ fontSize: 17, fontWeight: '800' }}>{hhmm(r.startsAt)}</Body>
                        </View>
                        <View style={{ width: 1, alignSelf: 'stretch', backgroundColor: p.hairline }} />
                        <View style={{ flex: 1, gap: 5 }}>
                          <Body strong numberOfLines={1}>{r.serviceName}</Body>
                          {r.trainerName ? <Body faint style={{ fontSize: 12.5 }}>{r.trainerName}</Body> : null}
                        </View>
                        <Pill label={st?.label ?? r.status} tone={st?.tone ?? 'muted'} />
                      </View>
                    </Card>
                  </FadeInUp>
                )
              })}
            </>
          ) : null}
        </ScrollView>
      )}
    </SafeAreaView>
  )
}

function Segment({ label, on, onPress, badge }: { label: string; on: boolean; onPress: () => void; badge?: number }) {
  const p = usePalette()
  return (
    <PressableScale onPress={onPress} style={{ flex: 1 }}>
      <View style={[{ flex: 1, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', paddingVertical: space(2.25), borderRadius: radius.pill, backgroundColor: on ? p.surface : 'transparent' }, on ? shadow(1) : null]}>
        <Body style={{ fontSize: 13.5, fontWeight: '700', color: on ? p.text : p.textMuted }}>{label}</Body>
        {badge ? (
          <View style={{ minWidth: 18, height: 18, paddingHorizontal: 5, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? p.accent : p.hairline }}>
            <Body style={{ fontSize: 11, fontWeight: '800', color: on ? p.accentText : p.textMuted }}>{badge}</Body>
          </View>
        ) : null}
      </View>
    </PressableScale>
  )
}

function SectionLabel({ children }: { children: string }) {
  const p = usePalette()
  return <Body style={{ fontSize: 12.5, fontWeight: '800', letterSpacing: 0.6, color: p.textMuted, textTransform: 'uppercase', marginTop: space(1), marginBottom: space(0.5) }}>{children}</Body>
}
