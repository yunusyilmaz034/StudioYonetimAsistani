import { Linking, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useLocalSearchParams } from 'expo-router'

import type { ProgramExercise } from '@studio/core/client'
import { api, type TrainingBundle } from '@/lib/api'
import { useFetch } from '@/lib/useFetch'
import { FadeInUp } from '@/components/motion'
import { PressableScale } from '@/components/motion'
import { Body, Card, Eyebrow, Hero, Loading, Pill, Screen } from '@/components/ui'
import { radius, space, typo as t, usePalette } from '@/theme'

export default function ProgramDetail() {
  const p = usePalette()
  const { id } = useLocalSearchParams<{ id: string }>()
  const { data, loading } = useFetch(api.training)
  if (loading && !data) return <Loading />
  const t2 = data as TrainingBundle | null
  const program = t2?.programs.find((pr) => pr.id === id) ?? null
  if (!program) return <Screen><Body muted>Program bulunamadı.</Body></Screen>
  const version = program.versions.find((v) => v.version === program.currentVersion) ?? program.versions[program.versions.length - 1]
  const guides = t2?.guides ?? {}

  return (
    <Screen>
      <FadeInUp index={0}>
        <Hero>
          <Body style={[t.caption, { color: p.onGradMuted }]}>Antrenman Programı</Body>
          <Body style={[t.h1, { color: p.onGrad }]}>{program.title}</Body>
          <View style={{ flexDirection: 'row', gap: space(2), marginTop: space(1) }}>
            <View style={{ backgroundColor: '#FFFFFF22', paddingHorizontal: space(3), paddingVertical: space(1.5), borderRadius: 999 }}>
              <Body style={{ color: p.onGrad, fontWeight: '700', fontSize: 13 }}>{version?.days.length ?? 0} gün</Body>
            </View>
            <View style={{ backgroundColor: '#FFFFFF22', paddingHorizontal: space(3), paddingVertical: space(1.5), borderRadius: 999 }}>
              <Body style={{ color: p.onGrad, fontWeight: '700', fontSize: 13 }}>v{program.currentVersion}</Body>
            </View>
          </View>
        </Hero>
      </FadeInUp>

      {version?.days.map((day, di) => (
        <FadeInUp key={day.order} index={di + 1}>
          <Eyebrow>{day.name}</Eyebrow>
          <View style={{ gap: space(2.5) }}>
            {day.exercises.map((ex) => (
              <ExerciseCard key={`${day.order}-${ex.order}`} ex={ex} muscle={guides[ex.exerciseId]?.muscleGroup ?? null} />
            ))}
          </View>
        </FadeInUp>
      ))}
    </Screen>
  )
}

function ExerciseCard({ ex, muscle }: { ex: ProgramExercise; muscle: string | null }) {
  const p = usePalette()
  const video = ex.videoUrl
  return (
    <Card inset>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(3) }}>
        <View style={{ flex: 1, gap: 6 }}>
          <Body strong style={{ fontSize: 16 }}>{ex.nameTr}</Body>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space(2) }}>
            <Pill label={`${ex.sets} × ${ex.reps}`} tone="accent" />
            {ex.restSeconds > 0 ? <Pill label={`${ex.restSeconds}sn ara`} /> : null}
            {ex.tempo ? <Pill label={ex.tempo} /> : null}
            {muscle ? <Pill label={muscle} tone="good" /> : null}
          </View>
          {ex.note ? <Body muted style={{ fontSize: 13.5 }}>{ex.note}</Body> : null}
        </View>
        {video ? (
          <PressableScale onPress={() => void Linking.openURL(video)}>
            <View style={{ width: 52, height: 52, borderRadius: radius.md, backgroundColor: p.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="play" size={22} color={p.accent} />
            </View>
          </PressableScale>
        ) : null}
      </View>
    </Card>
  )
}
