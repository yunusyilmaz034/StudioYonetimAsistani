import { useMemo, useState } from 'react'
import { Alert, Modal, TextInput, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useLocalSearchParams } from 'expo-router'

import type { ExerciseGuide, FeedbackReason, ProgramExercise } from '@studio/core/client'
import { api, type TrainingBundle, type WorkoutSetEntryDto } from '@/lib/api'
import { useFetch } from '@/lib/useFetch'
import { WorkoutDay } from '@/components/workout-day'
import { ExerciseGuideSheet } from '@/components/exercise-guide-sheet'
import { FadeInUp, PressableScale } from '@/components/motion'
import { Body, Button, Card, Eyebrow, Hero, Loading, Pill, Screen } from '@/components/ui'
import { VideoModal } from '@/components/video-modal'
import { radius, shadow, space, typo as t, usePalette } from '@/theme'

const REASONS: { key: FeedbackReason; label: string }[] = [
  { key: 'pain', label: 'Ağrı / rahatsızlık' },
  { key: 'too_hard', label: 'Çok zor' },
  { key: 'too_easy', label: 'Çok kolay' },
  { key: 'not_felt', label: 'Hedef kası hissetmedim' },
  { key: 'machine_busy', label: 'Alet meşguldü' },
  { key: 'video_unclear', label: 'Video net değil' },
  { key: 'other', label: 'Diğer' },
]

type Target = { programId: string; programVersion: number; dayOrder: number; exerciseId: string; name: string }

export default function ProgramDetail() {
  const p = usePalette()
  const { id } = useLocalSearchParams<{ id: string }>()
  const { data, loading, reload } = useFetch(api.training)
  const [target, setTarget] = useState<Target | null>(null)
  // The guide and the video are opened from the exercise card and belong to the SCREEN, not to the
  // card: a sheet mounted inside a row inherits the row's stacking, and on Android that is how a
  // modal ends up behind the list it was opened from.
  const [guide, setGuide] = useState<ExerciseGuide | null>(null)
  const [video, setVideo] = useState<{ url: string; title: string } | null>(null)
  // Where she is in the cycle. Fetched separately from the programme because it changes on every
  // completed day while the programme itself does not.
  const progress = useFetch(useMemo(() => () => api.workout(String(id)), [id]))

  if (loading && !data) return <Loading />
  const t2 = data as TrainingBundle | null
  const program = t2?.programs.find((pr) => pr.id === id) ?? null
  if (!program) return <Screen header><Body muted>Program bulunamadı.</Body></Screen>
  const version = program.versions.find((v) => v.version === program.currentVersion) ?? program.versions[program.versions.length - 1]
  const guides = t2?.guides ?? {}
  const cycle = progress.data?.cycle ?? { completed: 0, nextDayOrder: 1, rounds: 0 }
  const logs = progress.data?.logs ?? []

  return (
    <Screen header>
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

      {/* WHAT SHE HAS DONE, never what she missed (owner, 2026-08-06: "üyeye hayır, panelde evet").
          "Bu hafta sadece 2 gün geldin" reads as an accusation to a member who had a reason the app
          cannot know, and the app she feels judged by is the one she stops opening. Only what has
          accumulated is said here; the gap is Işıl's to see, and Işıl can pick up a phone. */}
      {cycle.completed > 0 ? (
        <FadeInUp index={1}>
          <View style={{ gap: 5 }}>
            <Body strong style={{ fontSize: 15 }}>
              {cycle.rounds > 0 ? `${cycle.rounds}. turdasın` : 'İlk turundasın'}
            </Body>
            <Body muted style={{ fontSize: 13.5 }}>
              Toplam {cycle.completed} antrenman · sırada {version?.days.find((d) => d.order === cycle.nextDayOrder)?.name ?? `Gün ${cycle.nextDayOrder}`}
            </Body>
          </View>
        </FadeInUp>
      ) : null}

      {/* The day she is ON comes first, whatever its position in the programme. Rendering in
          programme order put two locked days above the one she can actually do the moment the cycle
          wrapped past the last day — the screen's most important row, buried under the ones it had
          just told her she may not open. The rest keep their own order underneath. */}
      {[...(version?.days ?? [])]
        .sort((a, b) => Number(b.order === cycle.nextDayOrder) - Number(a.order === cycle.nextDayOrder))
        .map((day, di) => (
        <FadeInUp key={day.order} index={di + 2}>
          <WorkoutDay
            day={day}
            isNext={day.order === cycle.nextDayOrder}
            doneCount={logs.filter((l) => l.dayOrder === day.order).length}
            nextDayName={version?.days.find((d) => d.order === cycle.nextDayOrder)?.name ?? `Gün ${cycle.nextDayOrder}`}
            sayWhy={di === 1}
            onComplete={async (entries: readonly WorkoutSetEntryDto[], note: string) => {
              const res = await api.completeWorkout({
                programId: program.id,
                dayOrder: day.order,
                performedOn: new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format(new Date()),
                entries,
                note,
              })
              if (res.ok) void progress.reload()
              return res.ok
            }}
          >
          <View style={{ gap: space(2.5) }}>
            {day.exercises.map((ex) => (
              <ExerciseCard
                key={`${day.order}-${ex.order}`}
                ex={ex}
                muscle={guides[ex.exerciseId]?.muscleGroup ?? null}
                // The card opens the guide only where one exists. A row that looks pressable and
                // does nothing is worse than a row that does not look pressable.
                onOpenGuide={guides[ex.exerciseId] ? () => setGuide(guides[ex.exerciseId]!) : undefined}
                // The video prefers the exercise's own link and falls back to the library's — a
                // trainer may override the clip for one programme without editing the library.
                onPlay={() => {
                  const url = ex.videoUrl ?? guides[ex.exerciseId]?.videoUrl ?? null
                  if (url) setVideo({ url, title: ex.nameTr })
                }}
                hasVideo={Boolean(ex.videoUrl ?? guides[ex.exerciseId]?.videoUrl)}
                onFeedback={() => setTarget({ programId: program.id, programVersion: program.currentVersion, dayOrder: day.order, exerciseId: ex.exerciseId, name: ex.nameTr })}
              />
            ))}
          </View>
          </WorkoutDay>
        </FadeInUp>
      ))}

      {target ? <FeedbackModal target={target} onClose={() => setTarget(null)} onSent={() => { setTarget(null); void reload() }} /> : null}
      {guide ? <ExerciseGuideSheet guide={guide} onClose={() => setGuide(null)} /> : null}
      {video ? <VideoModal url={video.url} title={video.title} onClose={() => setVideo(null)} /> : null}
    </Screen>
  )
}

function ExerciseCard({
  ex,
  muscle,
  hasVideo,
  onOpenGuide,
  onPlay,
  onFeedback,
}: {
  ex: ProgramExercise
  muscle: string | null
  hasVideo: boolean
  onOpenGuide?: () => void
  onPlay: () => void
  onFeedback: () => void
}) {
  const p = usePalette()
  return (
    // Pressing the row opens the movement guide (owner, 2026-08-01) — the same guide the web panel
    // shows. The two round buttons keep their own jobs, so a tap meant for "video" never opens a
    // sheet she did not ask for.
    <Card inset onPress={onOpenGuide}>
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
          {/* The row is pressable and nothing else says so — a phone has no hover to discover it with. */}
          {onOpenGuide ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Ionicons name="book-outline" size={13} color={p.accent} />
              <Body style={{ fontSize: 12.5, fontWeight: '600', color: p.accent }}>Hareket rehberi</Body>
            </View>
          ) : null}
        </View>
        <View style={{ gap: space(2) }}>
          {hasVideo ? (
            <PressableScale onPress={onPlay}>
              <View style={{ width: 46, height: 46, borderRadius: radius.md, backgroundColor: p.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
                <Ionicons name="play" size={20} color={p.accent} />
              </View>
            </PressableScale>
          ) : null}
          <PressableScale onPress={onFeedback}>
            <View style={{ width: 46, height: 46, borderRadius: radius.md, backgroundColor: p.surfaceMuted, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="chatbubble-ellipses-outline" size={20} color={p.textMuted} />
            </View>
          </PressableScale>
        </View>
      </View>
    </Card>
  )
}

function FeedbackModal({ target, onClose, onSent }: { target: Target; onClose: () => void; onSent: () => void }) {
  const p = usePalette()
  const [reason, setReason] = useState<FeedbackReason | null>(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  async function send() {
    if (!reason) return Alert.alert('Bir neden seç')
    if (message.trim().length < 2) return Alert.alert('Kısa bir mesaj yaz')
    setBusy(true)
    try {
      const res = await api.leaveFeedback({ programId: target.programId, programVersion: target.programVersion, dayOrder: target.dayOrder, exerciseId: target.exerciseId, reason, message: message.trim() })
      if (res.ok) { Alert.alert('Gönderildi ✓', 'Eğitmenin en kısa sürede dönecek.'); onSent() }
      else Alert.alert('Gönderilemedi', 'Tekrar dene.')
    } catch { Alert.alert('Hata', 'Gönderilemedi.') } finally { setBusy(false) }
  }

  return (
    <Modal transparent animationType="slide" visible onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: '#00000066' }}>
        <View style={[{ backgroundColor: p.bgElevated, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: space(5), paddingBottom: space(9), gap: space(3) }, shadow(3)]}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Body strong style={{ fontSize: 18 }}>Geri Bildirim</Body>
            <PressableScale onPress={onClose}><Ionicons name="close" size={24} color={p.textMuted} /></PressableScale>
          </View>
          <Body muted>{target.name}</Body>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space(2) }}>
            {REASONS.map((r) => (
              <PressableScale key={r.key} onPress={() => setReason(r.key)}>
                <View style={{ paddingHorizontal: space(3), paddingVertical: space(2), borderRadius: radius.pill, backgroundColor: reason === r.key ? p.accent : p.surface, borderWidth: 1, borderColor: reason === r.key ? p.accent : p.hairline }}>
                  <Body style={{ color: reason === r.key ? p.accentText : p.text, fontWeight: '600', fontSize: 13.5 }}>{r.label}</Body>
                </View>
              </PressableScale>
            ))}
          </View>
          <TextInput
            value={message}
            onChangeText={setMessage}
            placeholder="Eğitmenine yazmak istediğin…"
            placeholderTextColor={p.textFaint}
            multiline
            style={{ minHeight: 90, backgroundColor: p.surface, borderColor: p.hairline, borderWidth: 1, borderRadius: radius.md, padding: space(3.5), fontSize: 15, color: p.text, textAlignVertical: 'top' }}
          />
          <Button label="Gönder" onPress={() => void send()} loading={busy} />
        </View>
      </View>
    </Modal>
  )
}
