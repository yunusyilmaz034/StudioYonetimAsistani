import { useMemo, useState } from 'react'
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router } from 'expo-router'

import type { MemberReservation, MemberSession } from '@studio/core/client'
import { api } from '@/lib/api'
import { useFetch } from '@/lib/useFetch'
import { FadeInUp, PressableScale } from '@/components/motion'
import { Body, ScreenSkeleton, TopStrip } from '@/components/ui'
import { EmptyState, PremiumCard, SegmentedControl, StatusChip, Txt } from '@/components/kit'
import { radius, space, typo as t, usePalette, trUpper } from '@/theme'

// ── AJANDA — a day is a timetable, not two lists (owner-approved, 2026-08-06) ────────────────
//
// The screen used to open with a choice: "Rezervasyon Yap" or "Rezervasyonlarım". A day does not
// divide that way. Her own class now sits in the same list as every other class that day, marked
// with a rail down its left — she answers "what is on today" and "what is mine" in one look, having
// chosen nothing.
//
// ── AND WHY IT SPLIT AGAIN (owner, 2026-08-13) ──────────────────────────────────────────────
//
// The rail was not enough, and the reason is that the timetable shows ONE DAY. "Where am I booked?"
// is a question about the week, not about today: a member who booked Tuesday could only find it by
// tapping Tuesday. Marking her class inside a day answers "what is on today" and cannot answer
// "what did I book" — the owner called the gap büyük eksiklik and he was right.
//
// So: two views, one screen. `Rezervasyonlarım` opens first because that is the question she comes
// with; `Rezervasyon Yap` is the timetable exactly as it was, layout untouched. Past reservations
// stay OUT of the way behind a disclosure — she is not browsing history, she is checking a plan.
//
// What did NOT change: booking, cancelling, the blocked reasons, and the rule that a member cannot
// cancel inside the window (OR-30) — which this layout finally makes legible, because the row simply
// has no button and says why.

const WD = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt']
const dayKey = (ms: number) => new Date(ms).toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit' })
const hhmm = (ms: number) => new Date(ms).toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' })
const shortDay = (ms: number) => new Date(ms).toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul', day: 'numeric', month: 'short' })
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
  const [view, setView] = useState<'mine' | 'book'>('mine')
  const [pastOpen, setPastOpen] = useState(false)

  const sessions = agenda.data?.sessions ?? []
  const upcoming = reservations.data?.upcoming ?? []
  const past = reservations.data?.past ?? []
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
        <TopStrip label={view === 'mine' ? trUpper('Rezervasyonlarım') : monthTr(activeMs)} onQr={() => router.push('/qr')} />

        {/* Two questions, one screen. A segmented control rather than two underlined words: the
            same control the rest of the app now uses to switch between two peers. */}
        <SegmentedControl
          value={view}
          onChange={setView}
          options={[
            { key: 'mine', label: upcoming.length > 0 ? `Rezervasyonlarım · ${upcoming.length}` : 'Rezervasyonlarım' },
            { key: 'book', label: 'Rezervasyon Yap' },
          ]}
        />

        {/* Seven days. Selection is an underline, not a filled tile — the same mark the tab bar uses.
            A sage dot means she has a class that day; a faded date means the studio has nothing on. */}
        {view === 'book' ? (
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          {week.map((d) => {
            const on = d.key === active
            return (
              <PressableScale key={d.key} onPress={() => setSel(d.key)}>
                <View style={{ width: 40, alignItems: 'center', paddingBottom: space(2) }}>
                  <Body style={[t.eyebrow, { fontSize: 9.5, color: d.any ? p.textMuted : p.border }]}>
                    {trUpper(WD[new Date(d.ms).getDay()])}
                  </Body>
                  <Body style={[t.numSm, { marginTop: 3, color: on ? p.primary : d.any ? p.textPrimary : p.textMuted }]}>
                    {new Date(d.ms).getDate()}
                  </Body>
                  <View style={{ width: 4, height: 4, borderRadius: 2, marginTop: 4, backgroundColor: d.mine ? p.success : 'transparent' }} />
                  <View style={{ height: 2, width: 20, marginTop: 4, borderRadius: 2, backgroundColor: on ? p.primary : 'transparent' }} />
                </View>
              </PressableScale>
            )
          })}
        </View>
        ) : null}
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: space(5), paddingTop: space(5), paddingBottom: space(10) }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={agenda.loading} onRefresh={reload} tintColor={p.accent} />}
      >
        {view === 'mine' ? (
          <MineView
            upcoming={upcoming}
            past={past}
            pastOpen={pastOpen}
            togglePast={() => setPastOpen((v) => !v)}
            busyId={busyId}
            onCancel={askCancel}
            onBook={() => setView('book')}
          />
        ) : (
        <>
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
          const blocked = s.blockedReason ? BLOCKED[s.blockedReason] : seatsLeft <= 0 ? BLOCKED.full : null
          const locked = res ? (res.startsAt - Date.now()) / 3_600_000 <= res.cancellationWindowHours : false
          return (
            <FadeInUp key={s.sessionId} index={i}>
              <View style={{ marginBottom: space(3) }}>
                <PremiumCard>
                  <View style={{ flexDirection: 'row', gap: space(3.5), alignItems: 'flex-start' }}>
                    {/* Her own class keeps its rail — now inside the card, where it reads as a mark on
                        the row rather than a line cutting the page. */}
                    {mine ? <View style={{ width: 3, alignSelf: 'stretch', borderRadius: 2, backgroundColor: p.primary }} /> : null}

                    <Txt role="body" numberOfLines={1} tone={mine ? 'brand' : 'primary'} style={[t.numSm, { width: 56 }]}>
                      {hhmm(s.startsAt)}
                    </Txt>

                    <View style={{ flex: 1, gap: space(1) }}>
                      <Txt role="h3" numberOfLines={1}>{s.serviceName}</Txt>
                      {s.trainerName || s.roomName ? (
                        <Txt role="caption" tone="muted" numberOfLines={1}>{[s.trainerName, s.roomName].filter(Boolean).join(' · ')}</Txt>
                      ) : null}

                      {mine ? (
                        <View style={{ flexDirection: 'row', marginTop: space(1) }}>
                          <StatusChip label="Rezervasyonun" tone="brand" />
                        </View>
                      ) : blocked ? (
                        <View style={{ flexDirection: 'row', marginTop: space(1) }}>
                          <StatusChip label={blocked.label} tone={s.blockedReason === 'full' ? 'neutral' : 'warning'} />
                        </View>
                      ) : (
                        <Txt role="caption" tone={seatsLeft <= 2 ? 'warning' : 'muted'} style={{ marginTop: space(0.5) }}>
                          {seatsLeft <= 2 ? `Son ${seatsLeft} yer` : `${seatsLeft} yer kaldı`}
                        </Txt>
                      )}

                      {mine && locked ? (
                        <Txt role="caption" tone="muted">İptal süresi doldu — gelemezsen bizi ara.</Txt>
                      ) : null}
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
                </PremiumCard>
              </View>
            </FadeInUp>
          )
        })}

        </>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

// ── REZERVASYONLARIM ────────────────────────────────────────────────────────────────────────
//
// Upcoming across the WHOLE week, which is the thing the day-by-day timetable structurally could not
// show. Past sits behind a disclosure and starts CLOSED: she opens this to check a plan, not to read
// history, and a list that opens with last month's classes buries tomorrow's.
function MineView({
  upcoming,
  past,
  pastOpen,
  togglePast,
  busyId,
  onCancel,
  onBook,
}: {
  upcoming: readonly MemberReservation[]
  past: readonly MemberReservation[]
  pastOpen: boolean
  togglePast: () => void
  busyId: string | null
  onCancel: (r: MemberReservation) => void
  onBook: () => void
}) {
  const p = usePalette()
  const sorted = [...upcoming].sort((a, b) => a.startsAt - b.startsAt)
  const recent = [...past].sort((a, b) => b.startsAt - a.startsAt).slice(0, 20)

  return (
    <>
      {sorted.length === 0 ? (
        <EmptyState
          icon="calendar-outline"
          title="Henüz rezervasyonun yok"
          body="Uygun dersleri görüp yerini ayırtabilirsin."
          cta="Ders ara"
          onCta={onBook}
        />
      ) : (
        <View style={{ gap: space(1), marginBottom: space(4) }}>
          <Txt role="h1">Yaklaşan</Txt>
          <Txt role="caption" tone="muted">{sorted.length === 1 ? 'Bir dersin var' : `${sorted.length} dersin var`}</Txt>
        </View>
      )}

      {sorted.map((r, i) => {
        const locked = (r.startsAt - Date.now()) / 3_600_000 <= r.cancellationWindowHours
        return (
          <FadeInUp key={r.reservationId} index={i}>
            <View style={{ marginBottom: space(3) }}>
              <PremiumCard>
                <View style={{ flexDirection: 'row', gap: space(3.5), alignItems: 'flex-start' }}>
                  <View style={{ width: 3, alignSelf: 'stretch', borderRadius: 2, backgroundColor: p.primary }} />
                  <View style={{ width: 54 }}>
                    <Txt role="body" tone="brand" style={t.numSm}>{hhmm(r.startsAt)}</Txt>
                    <Txt role="caption" tone="muted">{shortDay(r.startsAt)}</Txt>
                  </View>
                  <View style={{ flex: 1, gap: space(1) }}>
                    <Txt role="h3" numberOfLines={1}>{r.serviceName}</Txt>
                    {r.trainerName || r.roomName ? (
                      <Txt role="caption" tone="muted" numberOfLines={1}>{[r.trainerName, r.roomName].filter(Boolean).join(' · ')}</Txt>
                    ) : null}
                    {locked ? <Txt role="caption" tone="muted">İptal süresi doldu — gelemezsen bizi ara.</Txt> : null}
                  </View>
                  {!locked ? <Action label="İptal" ghost busy={busyId === r.sessionId} onPress={() => onCancel(r)} /> : null}
                </View>
              </PremiumCard>
            </View>
          </FadeInUp>
        )
      })}

      {/* Past stays behind a disclosure and starts CLOSED — she opens this to check a plan, not to
          read history, and a list that opens with last month's classes buries tomorrow's. */}
      {recent.length > 0 ? (
        <View style={{ marginTop: space(4) }}>
          <PressableScale onPress={togglePast}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: space(3.5) }}>
              <Txt role="body" tone="secondary">Geçmiş rezervasyonlarım · {recent.length}</Txt>
              <Txt role="body" tone="muted">{pastOpen ? '−' : '+'}</Txt>
            </View>
          </PressableScale>

          {pastOpen
            ? recent.map((r) => (
                <View key={r.reservationId} style={{ marginBottom: space(2) }}>
                  <PremiumCard>
                    <View style={{ flexDirection: 'row', gap: space(3.5), alignItems: 'center' }}>
                      <View style={{ width: 54 }}>
                        <Txt role="body" tone="muted" style={t.numSm}>{hhmm(r.startsAt)}</Txt>
                        <Txt role="caption" tone="muted">{shortDay(r.startsAt)}</Txt>
                      </View>
                      <Txt role="body" tone="secondary" numberOfLines={1} style={{ flex: 1 }}>{r.serviceName}</Txt>
                    </View>
                  </PremiumCard>
                </View>
              ))
            : null}
        </View>
      ) : null}
    </>
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
          backgroundColor: ghost ? 'transparent' : p.primary,
          borderWidth: ghost ? StyleSheet.hairlineWidth * 2 : 0,
          borderColor: p.border,
        }}
      >
        <Body style={[t.button, { fontSize: 12.5, color: ghost ? p.textSecondary : p.onPrimary }]}>{busy ? '…' : label}</Body>
      </View>
    </Pressable>
  )
}
