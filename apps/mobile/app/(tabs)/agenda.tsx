import { useMemo, useState } from 'react'
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router } from 'expo-router'

import type { MemberReservation, MemberSession } from '@studio/core/client'
import { api } from '@/lib/api'
import { useFetch } from '@/lib/useFetch'
import { FadeInUp, PressableScale } from '@/components/motion'
import { Body, Rule, ScreenSkeleton, TopStrip } from '@/components/ui'
import { radius, space, typo as t, usePalette, trUpper } from '@/theme'

// ── AJANDA — a day is a timetable, not two lists (owner-approved, 2026-08-06) ────────────────
//
// The screen used to open with a choice: "Rezervasyon Yap" or "Rezervasyonlarım". A day does not
// divide that way. Her own class now sits in the same list as every other class that day, marked
// with a rail down its left — she answers "what is on today" and "what is mine" in one look, having
// chosen nothing.
//
// Past reservations left this screen for Ben › Geçmiş rezervasyonlarım. Ajanda looks forward; "what
// did I do" is a different question and belongs somewhere else.
//
// What did NOT change: booking, cancelling, the blocked reasons, and the rule that a member cannot
// cancel inside the window (OR-30) — which this layout finally makes legible, because the row simply
// has no button and says why.

const WD = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt']
const dayKey = (ms: number) => new Date(ms).toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit' })
const hhmm = (ms: number) => new Date(ms).toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' })
const longDay = (ms: number) => new Date(ms).toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul', weekday: 'long', day: 'numeric', month: 'long' })
const monthTr = (ms: number) => new Date(ms).toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul', month: 'long', year: 'numeric' })

// A reason she cannot book, and — where one exists — the way out. A refused row that offers nothing
// is a dead end; every one of these has somewhere to go.
const BLOCKED: Record<string, { label: string; cta?: string; go?: () => void }> = {
  full: { label: 'Dolu' },
  no_credit: { label: 'Paketin bu dersi kapsamıyor', cta: 'Paket al', go: () => router.push('/buy') },
  self_booking_off: { label: 'Online rezervasyona kapalı' },
  past: { label: 'Geçti' },
}

export default function Ajanda() {
  const p = usePalette()
  const agenda = useFetch(api.agenda)
  const reservations = useFetch(api.reservations)
  const [sel, setSel] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const sessions = agenda.data?.sessions ?? []
  const upcoming = reservations.data?.upcoming ?? []
  const resBySession = useMemo(() => new Map(upcoming.map((r) => [r.sessionId, r])), [upcoming])

  // The next seven days, always — a week reads as a week even when the studio has nothing on a day.
  const week = useMemo(() => {
    const out: { key: string; ms: number; mine: boolean; any: boolean }[] = []
    for (let i = 0; i < 7; i++) {
      const d = new Date()
      d.setDate(d.getDate() + i)
      const k = dayKey(d.getTime())
      out.push({
        key: k,
        ms: d.getTime(),
        mine: upcoming.some((r) => dayKey(r.startsAt) === k),
        any: sessions.some((s) => dayKey(s.startsAt) === k),
      })
    }
    return out
  }, [sessions, upcoming])

  const active = sel ?? week[0]?.key ?? ''
  const daySessions = useMemo(
    () => sessions.filter((s) => dayKey(s.startsAt) === active).sort((a, b) => a.startsAt - b.startsAt),
    [sessions, active],
  )
  const activeMs = week.find((d) => d.key === active)?.ms ?? Date.now()
  const mineToday = daySessions.filter((s) => s.alreadyBooked).length

  const reload = () => {
    void agenda.reload()
    void reservations.reload()
  }

  async function book(s: MemberSession) {
    setBusyId(s.sessionId)
    try {
      const res = await api.book(s.sessionId)
      if (res.ok) reload()
      else Alert.alert('Rezervasyon yapılamadı', 'Tekrar dene.')
    } catch {
      Alert.alert('Hata', 'Rezervasyon yapılamadı, tekrar dene.')
    } finally {
      setBusyId(null)
    }
  }

  // Inside the window the app explains and stops (OR-30). The server refuses it too, so this dialog
  // is the courtesy, not the guard.
  function askCancel(r: MemberReservation) {
    const hoursUntil = (r.startsAt - Date.now()) / 3_600_000
    if (hoursUntil <= r.cancellationWindowHours) {
      Alert.alert(
        'İptal süresi doldu',
        `Ders başlamasına ${r.cancellationWindowHours} saatten az kaldığı için bu rezervasyon uygulamadan iptal edilemez. Gelemeyecekseniz lütfen stüdyoyu arayın.`,
        [{ text: 'Tamam' }],
      )
      return
    }
    Alert.alert(`${r.serviceName} · ${hhmm(r.startsAt)}`, 'Rezervasyonun iptal edilsin mi?', [
      { text: 'Vazgeç', style: 'cancel' },
      {
        text: 'İptal Et',
        style: 'destructive',
        onPress: async () => {
          setBusyId(r.sessionId)
          try {
            const res = await api.cancel(r.reservationId)
            if (res.ok) reload()
            else Alert.alert('İptal edilemedi', 'Tekrar dene.')
          } finally {
            setBusyId(null)
          }
        },
      },
    ])
  }

  if (agenda.loading && !agenda.data) return <ScreenSkeleton />

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: p.bg }} edges={['top']}>
      <View style={{ paddingHorizontal: space(5), paddingTop: space(2), gap: space(4) }}>
        <TopStrip label={monthTr(activeMs)} onQr={() => router.push('/qr')} />

        {/* Seven days. Selection is an underline, not a filled tile — the same mark the tab bar uses.
            A sage dot means she has a class that day; a faded date means the studio has nothing on. */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          {week.map((d) => {
            const on = d.key === active
            return (
              <PressableScale key={d.key} onPress={() => setSel(d.key)}>
                <View style={{ width: 40, alignItems: 'center', paddingBottom: space(2) }}>
                  <Body style={[t.eyebrow, { fontSize: 9.5, color: d.any ? p.textFaint : p.hairline }]}>
                    {trUpper(WD[new Date(d.ms).getDay()])}
                  </Body>
                  <Body style={[t.numSm, { marginTop: 3, color: on ? p.accent : d.any ? p.text : p.textFaint }]}>
                    {new Date(d.ms).getDate()}
                  </Body>
                  <View style={{ width: 4, height: 4, borderRadius: 2, marginTop: 4, backgroundColor: d.mine ? p.good : 'transparent' }} />
                  <View style={{ height: 2, width: 20, marginTop: 4, borderRadius: 2, backgroundColor: on ? p.accent : 'transparent' }} />
                </View>
              </PressableScale>
            )
          })}
        </View>
        <Rule />
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: space(5), paddingTop: space(5), paddingBottom: space(10) }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={agenda.loading} onRefresh={reload} tintColor={p.accent} />}
      >
        <View style={{ gap: 5, marginBottom: space(5) }}>
          <Body style={[t.h1, { color: p.text }]}>{longDay(activeMs)}</Body>
          <Body faint style={{ fontSize: 12.5 }}>
            {daySessions.length === 0
              ? 'Bugün için sana uygun ders yok'
              : `${daySessions.length} ders${mineToday > 0 ? ` · ${mineToday === 1 ? 'biri' : `${mineToday}’i`} senin` : ''}`}
          </Body>
        </View>

        {daySessions.map((s, i) => {
          const res = resBySession.get(s.sessionId)
          const mine = s.alreadyBooked
          const seatsLeft = Math.max(0, s.capacity - s.bookedCount)
          const blocked = s.blockedReason ? BLOCKED[s.blockedReason] : null
          const locked = res ? (res.startsAt - Date.now()) / 3_600_000 <= res.cancellationWindowHours : false
          return (
            <FadeInUp key={s.sessionId} index={i}>
              <View
                style={{
                  flexDirection: 'row',
                  gap: space(3.5),
                  paddingVertical: space(3.5),
                  borderTopWidth: StyleSheet.hairlineWidth * 2,
                  borderColor: p.hairline,
                  borderLeftWidth: mine ? 2 : 0,
                  borderLeftColor: p.accent,
                  paddingLeft: mine ? space(3) : 0,
                }}
              >
                <Body style={[t.numSm, { width: 54, color: mine ? p.accent : p.text }]}>{hhmm(s.startsAt)}</Body>

                <View style={{ flex: 1, gap: 3 }}>
                  <Body strong style={{ fontSize: 14.5 }} numberOfLines={1}>{s.serviceName}</Body>
                  {s.trainerName || s.roomName ? (
                    <Body muted style={{ fontSize: 12.5 }}>{[s.trainerName, s.roomName].filter(Boolean).join(' · ')}</Body>
                  ) : null}

                  {mine ? (
                    <>
                      <Body style={[t.eyebrow, { fontSize: 9.5, color: p.accent, marginTop: 3 }]}>{trUpper('Rezervasyonun')}</Body>
                      {locked ? (
                        <Body faint style={{ fontSize: 11.5, fontStyle: 'italic' }}>
                          İptal süresi doldu — gelemezsen bizi ara.
                        </Body>
                      ) : null}
                    </>
                  ) : blocked ? (
                    <Body style={{ fontSize: 12, marginTop: 3, color: s.blockedReason === 'full' ? p.textFaint : p.warn }}>{blocked.label}</Body>
                  ) : (
                    <Body style={{ fontSize: 12, marginTop: 3, color: seatsLeft <= 2 ? p.warn : p.textFaint, fontWeight: seatsLeft <= 2 ? '600' : '400' }}>
                      {seatsLeft <= 2 ? `Son ${seatsLeft} yer` : `${seatsLeft} yer kaldı`}
                    </Body>
                  )}
                </View>

                {/* One action per row, and only when there is one to offer. */}
                {mine && res && !locked ? (
                  <Action label="İptal" ghost busy={busyId === s.sessionId} onPress={() => askCancel(res)} />
                ) : !mine && !blocked ? (
                  <Action label="Rezerve" busy={busyId === s.sessionId} onPress={() => void book(s)} />
                ) : blocked?.cta && blocked.go ? (
                  <Action label={blocked.cta} ghost busy={false} onPress={blocked.go} />
                ) : null}
              </View>
            </FadeInUp>
          )
        })}

        {daySessions.length > 0 ? <Rule /> : null}
      </ScrollView>
    </SafeAreaView>
  )
}

function Action({ label, onPress, busy, ghost }: { label: string; onPress: () => void; busy: boolean; ghost?: boolean }) {
  const p = usePalette()
  return (
    <Pressable onPress={onPress} disabled={busy} style={({ pressed }) => ({ opacity: pressed || busy ? 0.6 : 1, alignSelf: 'center' })}>
      <View
        style={{
          paddingHorizontal: space(3.5),
          paddingVertical: space(2),
          borderRadius: radius.pill,
          backgroundColor: ghost ? 'transparent' : p.accent,
          borderWidth: ghost ? StyleSheet.hairlineWidth * 2 : 0,
          borderColor: p.hairline,
        }}
      >
        <Body style={{ fontSize: 12.5, fontWeight: '700', color: ghost ? p.textMuted : p.accentText }}>{busy ? '…' : label}</Body>
      </View>
    </Pressable>
  )
}
