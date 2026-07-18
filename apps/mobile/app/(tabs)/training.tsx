import { Fragment } from 'react'
import { Linking, RefreshControl, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'

import type { MemberProgram, ProgramExercise } from '@studio/core/client'
import { api, type TrainingBundle } from '@/lib/api'
import { shortDate } from '@/lib/format'
import { useFetch } from '@/lib/useFetch'
import { Body, Card, Empty, H1, H2, Loading, Pill, Screen } from '@/components/ui'
import { space, usePalette } from '@/theme'

export default function Training() {
  const p = usePalette()
  const { data, loading, reload } = useFetch(api.training)
  if (loading && !data) return <Loading />
  const t = data as TrainingBundle | null
  const program = t?.activeProgram ?? t?.programs[0] ?? null

  return (
    <Screen refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} tintColor={p.accent} />}>
      <H1>Antrenman</H1>

      <H2>Programım</H2>
      {program ? <ProgramView program={program} guides={t?.guides ?? {}} /> : <Empty text="Sana atanmış bir program yok." />}

      <H2>Ölçümler</H2>
      {t && t.measurements.length > 0 ? (
        t.measurements.slice(0, 6).map((m) => (
          <Card key={m.id}>
            <Body>{shortDate(m.takenOn)}</Body>
            <View style={{ flexDirection: 'row', gap: space(2), flexWrap: 'wrap' }}>
              {m.weightKg != null ? <Pill label={`${m.weightKg} kg`} /> : null}
              {m.fatPercent != null ? <Pill label={`Yağ %${m.fatPercent}`} /> : null}
              {m.musclePercent != null ? <Pill label={`Kas %${m.musclePercent}`} /> : null}
              {m.bmi != null ? <Pill label={`BMI ${m.bmi}`} /> : null}
            </View>
            {m.note ? <Body muted>{m.note}</Body> : null}
          </Card>
        ))
      ) : (
        <Empty text="Henüz ölçüm kaydın yok." />
      )}

      <H2>Geri Bildirimlerim</H2>
      {t && t.feedback.length > 0 ? (
        t.feedback.slice(0, 8).map((f) => (
          <Card key={f.id}>
            <Body>{t.guides[f.exerciseId]?.nameTr ?? 'Egzersiz'}</Body>
            <Body muted>{f.message}</Body>
            {f.trainerReply ? <Pill label={`Eğitmen: ${f.trainerReply}`} tone="good" /> : <Pill label="Yanıt bekliyor" tone="warn" />}
          </Card>
        ))
      ) : (
        <Empty text="Henüz geri bildirim vermedin." />
      )}
    </Screen>
  )
}

function ProgramView({ program, guides }: { program: MemberProgram; guides: TrainingBundle['guides'] }) {
  const version = program.versions.find((v) => v.version === program.currentVersion) ?? program.versions[program.versions.length - 1]
  return (
    <Card>
      <Body>{program.title}</Body>
      <Pill label={program.status === 'active' ? 'Aktif' : program.status} tone={program.status === 'active' ? 'good' : 'muted'} />
      {version?.days.map((day) => (
        <View key={day.order} style={{ gap: space(2), marginTop: space(2) }}>
          <H2>{day.name}</H2>
          {day.exercises.map((ex) => (
            <ExerciseRow key={`${day.order}-${ex.order}`} ex={ex} guide={guides[ex.exerciseId]} />
          ))}
        </View>
      ))}
    </Card>
  )
}

function ExerciseRow({ ex, guide }: { ex: ProgramExercise; guide: TrainingBundle['guides'][string] | undefined }) {
  const p = usePalette()
  const video = ex.videoUrl ?? guide?.videoUrl ?? null
  return (
    <View style={{ borderTopColor: p.border, borderTopWidth: 1, paddingTop: space(2), gap: space(1) }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Body>{ex.nameTr}</Body>
        {video ? <Ionicons name="logo-youtube" size={22} color={p.danger} onPress={() => void Linking.openURL(video)} /> : null}
      </View>
      <View style={{ flexDirection: 'row', gap: space(2), flexWrap: 'wrap' }}>
        <Pill label={`${ex.sets} set × ${ex.reps}`} />
        {ex.restSeconds > 0 ? <Pill label={`${ex.restSeconds}sn dinlenme`} /> : null}
        {ex.tempo ? <Pill label={`Tempo ${ex.tempo}`} /> : null}
        {guide?.muscleGroup ? <Pill label={guide.muscleGroup} tone="good" /> : null}
      </View>
      {ex.note ? <Body muted>{ex.note}</Body> : null}
    </View>
  )
}
