import { RefreshControl, StyleSheet, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { Redirect, router } from 'expo-router'

import { api } from '@/lib/api'
import { dayLabel, dayNote, kcalText } from '@/lib/energy'
import { useFetch } from '@/lib/useFetch'
import { WeekBars } from '@/components/energy'
import { FadeInUp, PressableScale, ProgressBar } from '@/components/motion'
import { Loading, Screen } from '@/components/ui'
import { ErrorState, PremiumCard, SectionHeader, Txt } from '@/components/kit'
import { space, typo as t, usePalette } from '@/theme'

// ── GEÇMİŞ (owner, 2026-10-13) ──────────────────────────────────────────────────────────────
//
// Thirty days, newest first. Two figures above — the daily average and how many of the last seven
// days she moved — and a row per day whose bar fills to that day's share of her best day. A row
// opens the day.
//
// No verdicts. A rest day is "Dinlenme", not a red mark: this studio's members train three days a
// week on purpose, and a screen that scolds the other four teaches them to stop opening it.

export default function EnergyHistory() {
  const p = usePalette()
  const { data, loading, reload } = useFetch(() => api.energy(30))
  if (loading && !data) return <Loading />
  if (!data) return <Screen header><ErrorState onRetry={reload} /></Screen>
  if (!data.started) return <Redirect href="/energy/start" />

  const days = data.days
  const week = days.slice(0, 7)
  const avg = week.length > 0 ? week.reduce((n, d) => n + d.totalKcal, 0) / week.length : 0
  const moved = week.filter((d) => d.activeKcal > 0).length
  const best = Math.max(1, ...days.map((d) => Math.max(d.totalKcal, d.intakeKcal ?? 0)))
  // What she ate, averaged over the days she LOGGED a meal — a day without one is "not logged", not
  // "ate nothing", and counting it as zero would make the average a lie. `null` under hidden figures.
  const logged = week.filter((d) => (d.meals?.length ?? 0) > 0 && typeof d.intakeKcal === 'number')
  const avgIn = logged.length > 0 ? logged.reduce((n, d) => n + (d.intakeKcal ?? 0), 0) / logged.length : null

  return (
    <Screen header refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} tintColor={p.accent} />}>
      <FadeInUp index={0}>
        <PremiumCard>
          <View style={{ flexDirection: 'row' }}>
            <View style={{ flex: 1, gap: 2 }}>
              <Txt role="caption" tone="muted">Günlük ortalama</Txt>
              <Text style={[t.numSm, { color: p.textPrimary }]}>{kcalText(avg)} kcal</Text>
            </View>
            {avgIn !== null ? (
              <View style={{ flex: 1, gap: 2, borderLeftWidth: StyleSheet.hairlineWidth * 2, borderColor: p.border, paddingLeft: space(4) }}>
                <Txt role="caption" tone="muted">Ortalama aldığın</Txt>
                <Text style={[t.numSm, { color: p.success }]}>{kcalText(avgIn)} kcal</Text>
              </View>
            ) : (
              <View style={{ flex: 1, gap: 2, borderLeftWidth: StyleSheet.hairlineWidth * 2, borderColor: p.border, paddingLeft: space(4) }}>
                <Txt role="caption" tone="muted">Hareketli gün</Txt>
                <Text style={[t.numSm, { color: p.textPrimary }]}>{moved} / {week.length}</Text>
              </View>
            )}
          </View>
          <View style={{ marginTop: space(5) }}>
            <WeekBars days={days} onSelect={(date) => router.push(`/energy?date=${date}`)} />
          </View>
        </PremiumCard>
      </FadeInUp>

      <FadeInUp index={1}>
        <View>
          <SectionHeader>Günler</SectionHeader>
          <PremiumCard padded={false}>
            {days.map((d, i) => (
              <PressableScale key={d.date} onPress={() => router.push(`/energy?date=${d.date}`)}>
                <View style={{ paddingHorizontal: space(4), paddingVertical: space(3), gap: space(2), borderBottomWidth: i === days.length - 1 ? 0 : StyleSheet.hairlineWidth * 2, borderColor: p.border, minHeight: 60 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(3) }}>
                    <View style={{ flex: 1, gap: 1 }}>
                      <Txt role="h3">{i === 0 ? `Bugün · ${dayLabel(d.date)}` : dayLabel(d.date)}</Txt>
                      <Txt role="caption" tone="secondary">{dayNote(d)}</Txt>
                    </View>
                    <Text style={[t.numSm, { color: p.textPrimary, fontSize: 17 }]}>{kcalText(d.totalKcal)}</Text>
                    <Ionicons name="chevron-forward" size={14} color={p.textMuted} />
                  </View>
                  <ProgressBar value={d.totalKcal / best} color={d.activeKcal > 0 ? p.primary : p.textMuted} track={p.surfaceMuted} height={6} />
                  {(d.meals?.length ?? 0) > 0 && typeof d.intakeKcal === 'number' ? (
                    <View style={{ gap: 2 }}>
                      <ProgressBar value={d.intakeKcal / best} color={p.success} track={p.surfaceMuted} height={6} />
                      <Txt role="caption" tone="muted">Aldığın · yaklaşık {kcalText(d.intakeKcal)} kcal</Txt>
                    </View>
                  ) : null}
                </View>
              </PressableScale>
            ))}
          </PremiumCard>
        </View>
      </FadeInUp>

      <Txt role="caption" tone="muted" align="center">Son 30 gün gösteriliyor. Rakamlar tahmindir; öğün girmediğin günler ortalamaya katılmaz.</Txt>
    </Screen>
  )
}
