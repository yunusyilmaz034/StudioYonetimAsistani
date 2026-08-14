import { RefreshControl, StyleSheet, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { router } from 'expo-router'

import { compareMeasurements, type MemberMeasurement, type MemberProgram } from '@studio/core/client'
import { api, type TrainingBundle } from '@/lib/api'
import { shortDate } from '@/lib/format'
import { useFetch } from '@/lib/useFetch'
import { FadeInUp } from '@/components/motion'
import { Body, Screen, ScreenSkeleton, TopStrip } from '@/components/ui'
import { EmptyState, PremiumCard, SectionHeader, StatusChip, Txt } from '@/components/kit'
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
          <View style={{ gap: space(1) }}>
            <Txt role="h1">{showPrograms ? 'Antrenman' : 'Ölçümlerim'}</Txt>
            <Txt role="caption" tone="muted">
              {showPrograms
                ? 'Programın ve ölçümlerin'
                : last
                  ? `Son ölçüm · ${shortDate(last.takenOn)}`
                  : 'Gelişimini takip et'}
            </Txt>
          </View>
        </View>
      </FadeInUp>

      {showPrograms ? (
        <FadeInUp index={1}>
          <View>
            <SectionHeader>Programlarım</SectionHeader>
            {programs.length > 0 ? (
              programs.map((prog) => <ProgramRow key={prog.id} program={prog} />)
            ) : (
              <EmptyState icon="barbell-outline" title="Sana atanmış bir program yok" body="Eğitmenin bir program tanımladığında burada görünür." />
            )}
          </View>
        </FadeInUp>
      ) : null}

      {last ? (
        <FadeInUp index={2}>
          <View>
            <SectionHeader>{showPrograms ? `Son ölçüm · ${shortDate(last.takenOn)}` : 'Son ölçüm'}</SectionHeader>
            <PremiumCard>
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
                    <Txt role="body" tone="secondary" style={{ flex: 1 }}>{r.label}</Txt>
                    <Body style={[t.numSm, { color: p.textPrimary, minWidth: 62, textAlign: 'right' }]}>{tr(kg)}</Body>
                    <Body style={[t.caption, { color: p.textMuted, minWidth: 48, textAlign: 'right' }]}>{pct !== null ? `%${tr(pct)}` : ''}</Body>
                    {/* The change since her previous reading. Sage up, mahogany down — a DIRECTION,
                        never a verdict: a member who traded fat for muscle must not be told she got
                        worse. */}
                    <Body style={{ fontSize: 12, fontWeight: '700', minWidth: 46, textAlign: 'right', color: delta === null ? p.textMuted : delta > 0 ? p.success : p.primary }}>
                      {delta === null ? '—' : `${delta > 0 ? '↑' : '↓'} ${tr(Math.abs(delta))}`}
                    </Body>
                  </View>
                )
              })}

            {change ? (
              <Txt role="caption" tone="muted" style={{ marginTop: space(2) }}>
                Bir önceki ölçüme göre · {change.days} gün arayla
              </Txt>
            ) : null}
            {Object.keys(last.circumferences).length > 0 ? (
              <View style={{ gap: space(2), marginTop: space(3), borderTopWidth: StyleSheet.hairlineWidth * 2, borderColor: p.border, paddingTop: space(3) }}>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space(4) }}>
                  {Object.entries(last.circumferences).map(([k, v]) => (
                    <View key={k} style={{ gap: 2 }}>
                      <Body style={[t.numSm, { color: p.textPrimary, fontSize: 17 }]}>{tr(v)}</Body>
                      <Txt role="caption" tone="muted">{k} · cm</Txt>
                    </View>
                  ))}
                </View>
              </View>
            ) : null}
            {last.note ? <Txt role="caption" tone="secondary" style={{ marginTop: space(2) }}>{last.note}</Txt> : null}
            </PremiumCard>
          </View>
        </FadeInUp>
      ) : (
        <FadeInUp index={2}>
          <View>
            <SectionHeader>Son ölçüm</SectionHeader>
            <EmptyState icon="pulse-outline" title="Henüz ölçüm kaydın yok" body="İlk ölçümünü resepsiyondan isteyebilirsin." />
          </View>
        </FadeInUp>
      )}

      {/* Her weight over time, as three plain figures — enough to see a direction without a chart. */}
      {measurements.length > 1 ? (
        <FadeInUp index={3}>
          <View>
            <SectionHeader>Geçmiş</SectionHeader>
            <PremiumCard>
            <View style={{ flexDirection: 'row' }}>
              {[...measurements].slice(0, 3).reverse().map((m, i) => (
                <View
                  key={m.id}
                  style={{
                    flex: 1,
                    gap: 3,
                    borderLeftWidth: i === 0 ? 0 : StyleSheet.hairlineWidth * 2,
                    borderColor: p.border,
                    paddingLeft: i === 0 ? 0 : space(3),
                  }}
                >
                  <Txt role="caption" tone="muted">{shortDate(m.takenOn)}</Txt>
                  <Body style={[t.numSm, { color: p.textPrimary }]}>{m.weightKg !== null ? tr(m.weightKg) : '—'}</Body>
                </View>
              ))}
            </View>
            <Txt role="caption" tone="muted" style={{ marginTop: space(2) }}>Kilo · kg</Txt>
            </PremiumCard>
          </View>
        </FadeInUp>
      ) : null}

      <FadeInUp index={4}>
        <View style={{ marginTop: space(2) }}>
          <Txt role="caption" tone="muted">
            Ölçümlerin stüdyodaki tartıdan alınır. Bir sonraki ölçümünü resepsiyondan isteyebilirsin.
          </Txt>
        </View>
      </FadeInUp>
    </Screen>
  )
}

const STATUS: Record<string, string> = { active: 'Aktif', draft: 'Taslak', completed: 'Tamamlandı', archived: 'Arşiv' }

function ProgramRow({ program }: { program: MemberProgram }) {
  const p = usePalette()
  const version = program.versions.find((v) => v.version === program.currentVersion) ?? program.versions[program.versions.length - 1]
  const days = version?.days.length ?? 0
  const exercises = version?.days.reduce((n, d) => n + d.exercises.length, 0) ?? 0
  const active = program.status === 'active'
  return (
    <View style={{ marginBottom: space(3) }}>
      <PremiumCard onPress={() => router.push(`/program/${program.id}`)}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(3) }}>
          <View
            style={{
              width: 40,
              height: 40,
              borderRadius: 20,
              backgroundColor: active ? p.primarySoft : p.surfaceMuted,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons name="barbell-outline" size={18} color={active ? p.primary : p.textMuted} />
          </View>
          <View style={{ flex: 1, gap: space(1) }}>
            <Txt role="h3" numberOfLines={1}>{program.title}</Txt>
            <Txt role="caption" tone="muted">
              {days} gün · {exercises} hareket{version ? ` · v${version.version}` : ''}
            </Txt>
          </View>
          <StatusChip label={STATUS[program.status] ?? program.status} tone={active ? 'success' : 'neutral'} />
          <Ionicons name="chevron-forward" size={16} color={p.textMuted} />
        </View>
      </PremiumCard>
    </View>
  )
}
