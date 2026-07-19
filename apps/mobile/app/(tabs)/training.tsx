import { RefreshControl, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { router } from 'expo-router'

import type { MemberProgram } from '@studio/core/client'
import { api, type TrainingBundle } from '@/lib/api'
import { shortDate } from '@/lib/format'
import { useFetch } from '@/lib/useFetch'
import { FadeInUp } from '@/components/motion'
import { Body, Card, Empty, Eyebrow, Loading, Pill, Screen, Title } from '@/components/ui'
import { radius, space, usePalette } from '@/theme'

const STATUS: Record<string, { label: string; tone: 'good' | 'muted' | 'gold' }> = {
  active: { label: 'Aktif', tone: 'good' },
  draft: { label: 'Taslak', tone: 'muted' },
  completed: { label: 'Tamamlandı', tone: 'gold' },
  archived: { label: 'Arşiv', tone: 'muted' },
}

export default function Training() {
  const p = usePalette()
  const { data, loading, reload } = useFetch(api.training)
  if (loading && !data) return <Loading />
  const t = data as TrainingBundle | null
  const programs = [...(t?.programs ?? [])].sort((a, b) => (a.status === 'active' ? -1 : b.status === 'active' ? 1 : 0))
  const lastM = t?.measurements[0] ?? null

  return (
    <Screen refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} tintColor={p.accent} />}>
      <Title sub="Programların ve gelişimin">Antrenman</Title>

      <Eyebrow>Programlarım</Eyebrow>
      {programs.length > 0 ? (
        programs.map((prog, i) => <ProgramCard key={prog.id} program={prog} index={i} />)
      ) : (
        <Card><Empty icon={<Ionicons name="clipboard-outline" size={30} color={p.textFaint} />} text="Sana atanmış bir program yok." /></Card>
      )}

      <FadeInUp index={programs.length + 1}>
        <Eyebrow>Ölçümlerim</Eyebrow>
        {lastM ? (
          <Card>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Body strong>Son ölçüm</Body>
              <Body muted>{shortDate(lastM.takenOn)}</Body>
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space(2) }}>
              {lastM.weightKg != null ? <Metric label="Kilo" value={`${lastM.weightKg} kg`} /> : null}
              {lastM.fatPercent != null ? <Metric label="Yağ" value={`%${lastM.fatPercent}`} /> : null}
              {lastM.musclePercent != null ? <Metric label="Kas" value={`%${lastM.musclePercent}`} /> : null}
              {lastM.bmi != null ? <Metric label="BMI" value={`${lastM.bmi}`} /> : null}
            </View>
          </Card>
        ) : (
          <Card><Empty icon={<Ionicons name="pulse-outline" size={28} color={p.textFaint} />} text="Henüz ölçüm kaydın yok." /></Card>
        )}
      </FadeInUp>
    </Screen>
  )
}

function ProgramCard({ program, index }: { program: MemberProgram; index: number }) {
  const p = usePalette()
  const s = STATUS[program.status] ?? STATUS.draft!
  const version = program.versions.find((v) => v.version === program.currentVersion) ?? program.versions[program.versions.length - 1]
  const days = version?.days.length ?? 0
  const exercises = version?.days.reduce((n, d) => n + d.exercises.length, 0) ?? 0
  return (
    <FadeInUp index={index}>
      <Card onPress={() => router.push(`/program/${program.id}`)} level={program.status === 'active' ? 2 : 1}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(3) }}>
          <View style={{ width: 52, height: 52, borderRadius: radius.md, backgroundColor: program.status === 'active' ? p.accent : p.surfaceMuted, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="barbell" size={24} color={program.status === 'active' ? p.accentText : p.textMuted} />
          </View>
          <View style={{ flex: 1, gap: 4 }}>
            <Body strong numberOfLines={1}>{program.title}</Body>
            <View style={{ flexDirection: 'row', gap: space(2), alignItems: 'center' }}>
              <Pill label={s.label} tone={s.tone} />
              <Body faint style={{ fontSize: 12.5 }}>{days} gün · {exercises} hareket</Body>
            </View>
          </View>
          <Ionicons name="chevron-forward" size={20} color={p.textFaint} />
        </View>
      </Card>
    </FadeInUp>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  const p = usePalette()
  return (
    <View style={{ backgroundColor: p.surfaceMuted, borderRadius: radius.sm, paddingHorizontal: space(3), paddingVertical: space(2), minWidth: 74 }}>
      <Body faint style={{ fontSize: 11.5, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</Body>
      <Body strong style={{ fontSize: 17 }}>{value}</Body>
    </View>
  )
}
