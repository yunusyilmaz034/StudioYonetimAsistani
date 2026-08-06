import { RefreshControl, StyleSheet, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { router } from 'expo-router'

import { compareMeasurements, type MemberMeasurement, type MemberProgram } from '@studio/core/client'
import { api, type TrainingBundle } from '@/lib/api'
import { shortDate } from '@/lib/format'
import { useFetch } from '@/lib/useFetch'
import { FadeInUp, PressableScale } from '@/components/motion'
import { Body, Empty, Rule, Screen, ScreenSkeleton, SectionLabel, TopStrip } from '@/components/ui'
import { space, typo as t, usePalette } from '@/theme'

// ── ANTRENMAN / ÖLÇÜMLERİM — one tab, two members (owner, 2026-08-06) ───────────────────────
//
// "sadece pilates olan üyenin antrenmanı olmaz sadece ölçüm olur ama fitness üyeliği varsa antrenman
// gözükecek yoksa hiç adı bile olmayacak."
//
// So a pilates-only member never meets the word: no "Programlarım" heading, no "sana atanmış program
// yok" empty state. Showing someone the absence of a service she did not buy sells nothing and reads
// as a fault. Measurements are on both — they belong to everyone — as the WHOLE screen for her, and
// under the programme for a gym member.
//
// `showPrograms` is the server's answer, never guessed from her packages here; the tab label reads
// from the same field.

// The order the scale prints them in, so the screen matches the sheet in her hand.
const ROWS: readonly { key: keyof MemberMeasurement; label: string; pct?: keyof MemberMeasurement }[] = [
  { key: 'weightKg', label: 'Kilo' },
  { key: 'idealWeightKg', label: 'İdeal kilo' },
  { key: 'leanMassKg', label: 'Yağsız kütle', pct: 'leanMassPercent' },
  { key: 'muscleKg', label: 'Kas', pct: 'musclePercent' },
  { key: 'waterKg', label: 'Sıvı', pct: 'waterPercent' },
  { key: 'fatKg', label: 'Yağ', pct: 'fatPercent' },
]

const num = (v: unknown): number | null => (typeof v === 'number' ? v : null)
const tr = (n: number) => String(n).replace('.', ',')

export default function Training() {
  const p = usePalette()
  const { data, loading, reload } = useFetch(api.training)
  if (loading && !data) return <ScreenSkeleton />
  const t2 = data as TrainingBundle | null
  const showPrograms = t2?.showPrograms ?? true
  const programs = [...(t2?.programs ?? [])].sort((a, b) => (a.status === 'active' ? -1 : b.status === 'active' ? 1 : 0))
  const measurements = t2?.measurements ?? []
  const last = measurements[0] ?? null
  const change = compareMeasurements(measurements)

  return (
    <Screen refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} tintColor={p.accent} />}>
      <FadeInUp index={0}>
        <View style={{ gap: space(4) }}>
          <TopStrip label="Gelişimin" onQr={() => router.push('/qr')} />
          <View style={{ gap: 5 }}>
            <Body style={[t.h1, { color: p.text }]}>{showPrograms ? 'Antrenman' : 'Ölçümlerim'}</Body>
            <Body faint style={{ fontSize: 12.5 }}>
              {showPrograms
                ? 'Programın ve ölçümlerin'
                : last
                  ? `Son ölçüm · ${shortDate(last.takenOn)}`
                  : 'Gelişimini takip et'}
            </Body>
          </View>
        </View>
      </FadeInUp>

      {showPrograms ? (
        <FadeInUp index={1}>
          <View style={{ gap: space(3) }}>
            <SectionLabel>Programlarım</SectionLabel>
            {programs.length > 0 ? (
              <View>
                {programs.map((prog, i) => (
                  <ProgramRow key={prog.id} program={prog} last={i === programs.length - 1} />
                ))}
              </View>
            ) : (
              <Body muted>Sana atanmış bir program yok.</Body>
            )}
          </View>
        </FadeInUp>
      ) : null}

      {last ? (
        <FadeInUp index={2}>
          <View style={{ gap: space(3) }}>
            <SectionLabel>{showPrograms ? `Son ölçüm · ${shortDate(last.takenOn)}` : 'Son ölçüm'}</SectionLabel>
            <View>
              {ROWS.map((r, i) => {
                const kg = num(last[r.key])
                if (kg === null) return null
                const pct = r.pct ? num(last[r.pct]) : null
                const delta = change?.rows.find((x) => x.key === r.key)?.diff ?? null
                return (
                  <View
                    key={String(r.key)}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'baseline',
                      gap: space(2.5),
                      paddingVertical: space(2.5),
                      borderBottomWidth: i === ROWS.length - 1 ? 0 : StyleSheet.hairlineWidth * 2,
                      borderColor: p.hairline,
                    }}
                  >
                    <Body muted style={{ flex: 1, fontSize: 13.5 }}>{r.label}</Body>
                    <Body style={[t.numSm, { color: p.text, minWidth: 62, textAlign: 'right' }]}>{tr(kg)}</Body>
                    <Body faint style={{ fontSize: 12, minWidth: 48, textAlign: 'right' }}>{pct !== null ? `%${tr(pct)}` : ''}</Body>
                    {/* The change since her previous reading. Sage up, mahogany down — a DIRECTION,
                        never a verdict: a member who traded fat for muscle must not be told she got
                        worse. */}
                    <Body style={{ fontSize: 12, fontWeight: '700', minWidth: 46, textAlign: 'right', color: delta === null ? p.textFaint : delta > 0 ? p.good : p.accent }}>
                      {delta === null ? '—' : `${delta > 0 ? '↑' : '↓'} ${tr(Math.abs(delta))}`}
                    </Body>
                  </View>
                )
              })}
            </View>
            {change ? (
              <Body faint style={{ fontSize: 11.5, fontStyle: 'italic' }}>
                Bir önceki ölçüme göre · {change.days} gün arayla
              </Body>
            ) : null}
            {Object.keys(last.circumferences).length > 0 ? (
              <View style={{ gap: space(2), marginTop: space(2) }}>
                <Rule />
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space(4), paddingTop: space(1) }}>
                  {Object.entries(last.circumferences).map(([k, v]) => (
                    <View key={k} style={{ gap: 2 }}>
                      <Body style={[t.numSm, { color: p.text, fontSize: 17 }]}>{tr(v)}</Body>
                      <Body faint style={{ fontSize: 11 }}>{k} · cm</Body>
                    </View>
                  ))}
                </View>
              </View>
            ) : null}
            {last.note ? <Body muted style={{ fontStyle: 'italic', fontSize: 13 }}>{last.note}</Body> : null}
          </View>
        </FadeInUp>
      ) : (
        <FadeInUp index={2}>
          <View style={{ gap: space(3) }}>
            <SectionLabel>Son ölçüm</SectionLabel>
            <Empty icon={<Ionicons name="pulse-outline" size={26} color={p.textFaint} />} text="Henüz ölçüm kaydın yok." />
          </View>
        </FadeInUp>
      )}

      {/* Her weight over time, as three plain figures — enough to see a direction without a chart. */}
      {measurements.length > 1 ? (
        <FadeInUp index={3}>
          <View style={{ gap: space(3) }}>
            <SectionLabel>Geçmiş</SectionLabel>
            <View style={{ flexDirection: 'row' }}>
              {[...measurements].slice(0, 3).reverse().map((m, i) => (
                <View
                  key={m.id}
                  style={{
                    flex: 1,
                    gap: 3,
                    borderLeftWidth: i === 0 ? 0 : StyleSheet.hairlineWidth * 2,
                    borderColor: p.hairline,
                    paddingLeft: i === 0 ? 0 : space(3),
                  }}
                >
                  <Body faint style={{ fontSize: 11 }}>{shortDate(m.takenOn)}</Body>
                  <Body style={[t.numSm, { color: p.text }]}>{m.weightKg !== null ? tr(m.weightKg) : '—'}</Body>
                </View>
              ))}
            </View>
            <Body faint style={{ fontSize: 11.5 }}>Kilo · kg</Body>
          </View>
        </FadeInUp>
      ) : null}

      <FadeInUp index={4}>
        <View style={{ gap: space(2), marginTop: space(2) }}>
          <Rule />
          <Body faint style={{ fontSize: 12, lineHeight: 18, paddingTop: space(2) }}>
            Ölçümlerin stüdyodaki tartıdan alınır. Bir sonraki ölçümünü resepsiyondan isteyebilirsin.
          </Body>
        </View>
      </FadeInUp>
    </Screen>
  )
}

const STATUS: Record<string, string> = { active: 'Aktif', draft: 'Taslak', completed: 'Tamamlandı', archived: 'Arşiv' }

function ProgramRow({ program, last }: { program: MemberProgram; last: boolean }) {
  const p = usePalette()
  const version = program.versions.find((v) => v.version === program.currentVersion) ?? program.versions[program.versions.length - 1]
  const days = version?.days.length ?? 0
  const exercises = version?.days.reduce((n, d) => n + d.exercises.length, 0) ?? 0
  return (
    <PressableScale onPress={() => router.push(`/program/${program.id}`)}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: space(3),
          paddingVertical: space(3.5),
          borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth * 2,
          borderColor: p.hairline,
        }}
      >
        <View
          style={{
            width: 38,
            height: 38,
            borderRadius: 19,
            borderWidth: StyleSheet.hairlineWidth * 2,
            borderColor: p.hairline,
            backgroundColor: p.surface,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Ionicons name="barbell-outline" size={17} color={program.status === 'active' ? p.accent : p.textFaint} />
        </View>
        <View style={{ flex: 1, gap: 3 }}>
          <Body strong style={{ fontSize: 14.5 }} numberOfLines={1}>{program.title}</Body>
          <Body faint style={{ fontSize: 12.5 }}>
            {days} gün · {exercises} hareket{version ? ` · v${version.version}` : ''}
          </Body>
        </View>
        {program.status === 'active' ? (
          <Body style={{ fontSize: 11, fontWeight: '700', color: p.good }}>{STATUS.active}</Body>
        ) : (
          <Body faint style={{ fontSize: 11 }}>{STATUS[program.status] ?? program.status}</Body>
        )}
        <Ionicons name="chevron-forward" size={16} color={p.textFaint} />
      </View>
    </PressableScale>
  )
}
