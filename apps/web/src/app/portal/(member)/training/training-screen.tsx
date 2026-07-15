'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ActivityIcon, DumbbellIcon, Loader2Icon, MessageCircleIcon, PlayCircleIcon } from 'lucide-react'
import { toast } from 'sonner'

import type { FeedbackReason, Measurement, Program, ProgramExercise, TrainingFeedback } from '@studio/core'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { MeasurementChart } from '@/components/training/measurement-chart'
import { domainErrorMessage } from '@/lib/domain-error'
import {
  FEEDBACK_REASON_LABEL,
  FEEDBACK_REASON_TONE,
  FEEDBACK_REASONS,
  FEEDBACK_STATUS_LABEL,
  PHOTO_ANGLE_LABEL,
  PROGRAM_STATUS_LABEL,
  PROGRAM_STATUS_TONE,
} from '@/lib/training-labels'
import { leaveFeedbackAction } from '@/server/actions/training'

interface PortalPhoto {
  id: string
  takenOn: string
  angle: 'front' | 'side' | 'back'
  note: string
  url: string | null
}

export function PortalTrainingScreen({
  active,
  programs,
  measurements,
  feedback,
  photos,
}: {
  active: Program | null
  programs: readonly Program[]
  measurements: readonly Measurement[]
  feedback: readonly TrainingFeedback[]
  photos: readonly PortalPhoto[]
}) {
  const past = programs.filter((p) => p.id !== active?.id)
  return (
    <main className="mx-auto max-w-3xl space-y-5 p-4 pb-8">
      <div>
        <h1 className="text-display font-semibold text-foreground">Antrenmanım</h1>
        <p className="text-sm text-muted-foreground">Programın, gelişimin ve eğitmenine geri bildirimlerin.</p>
      </div>

      <Tabs defaultValue="program">
        <TabsList className="flex w-full">
          <TabsTrigger value="program" className="min-h-9 flex-1">
            <DumbbellIcon className="size-4" /> Programım
          </TabsTrigger>
          <TabsTrigger value="progress" className="min-h-9 flex-1">
            <ActivityIcon className="size-4" /> Gelişimim
          </TabsTrigger>
        </TabsList>

        <TabsContent value="program">
          <ProgramTab active={active} past={past} feedback={feedback} />
        </TabsContent>
        <TabsContent value="progress">
          <ProgressTab measurements={measurements} photos={photos} />
        </TabsContent>
      </Tabs>
    </main>
  )
}

// ── Programım ────────────────────────────────────────────────────────────────────────────────────
function ProgramTab({
  active,
  past,
  feedback,
}: {
  active: Program | null
  past: readonly Program[]
  feedback: readonly TrainingFeedback[]
}) {
  if (!active) {
    return (
      <EmptyState
        icon={DumbbellIcon}
        title="Aktif programın yok"
        description="Eğitmenin sana bir program tanımladığında burada görünecek."
      />
    )
  }

  const version = active.versions.find((v) => v.version === active.currentVersion) ?? active.versions[active.versions.length - 1]

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-h2 font-semibold text-foreground">{active.title}</h2>
        <Badge className={PROGRAM_STATUS_TONE[active.status]}>{PROGRAM_STATUS_LABEL[active.status]}</Badge>
        {version ? <span className="text-xs text-muted-foreground">v{version.version}</span> : null}
      </div>

      {version?.days.map((day) => (
        <section key={day.order} className="space-y-2">
          <h3 className="text-h3 font-semibold text-foreground">{day.name}</h3>
          <ul className="space-y-2">
            {day.exercises.map((ex) => (
              <ExerciseCard
                key={ex.order}
                ex={ex}
                programId={active.id}
                programVersion={version.version}
                dayOrder={day.order}
              />
            ))}
          </ul>
        </section>
      ))}

      {feedback.length > 0 ? (
        <section className="space-y-2">
          <h3 className="text-h3 font-semibold text-foreground">Geri Bildirimlerim</h3>
          <ul className="space-y-2">
            {[...feedback]
              .sort((a, b) => b.createdAt - a.createdAt)
              .map((f) => (
                <li key={f.id} className="space-y-1.5 rounded-xl border border-border bg-card p-3 shadow-xs">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge className={FEEDBACK_REASON_TONE[f.reason]}>{FEEDBACK_REASON_LABEL[f.reason]}</Badge>
                    <Badge className="bg-muted text-muted-foreground">{FEEDBACK_STATUS_LABEL[f.status]}</Badge>
                  </div>
                  <p className="whitespace-pre-wrap text-sm text-foreground">{f.message}</p>
                  {f.trainerReply ? (
                    <div className="rounded-lg bg-primary-soft/40 p-2.5 text-sm">
                      <p className="text-[0.6875rem] font-medium uppercase tracking-wide text-primary">Eğitmenin yanıtı</p>
                      <p className="whitespace-pre-wrap text-foreground">{f.trainerReply}</p>
                    </div>
                  ) : null}
                </li>
              ))}
          </ul>
        </section>
      ) : null}

      {past.length > 0 ? (
        <section className="space-y-2">
          <h3 className="text-h3 font-semibold text-foreground">Geçmiş Programlar</h3>
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card shadow-xs">
            {past.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                <span className="truncate text-sm text-foreground">{p.title}</span>
                <Badge className={PROGRAM_STATUS_TONE[p.status]}>{PROGRAM_STATUS_LABEL[p.status]}</Badge>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}

function ExerciseCard({
  ex,
  programId,
  programVersion,
  dayOrder,
}: {
  ex: ProgramExercise
  programId: string
  programVersion: number
  dayOrder: number
}) {
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  return (
    <li className="space-y-2 rounded-xl border border-border bg-card p-3 shadow-xs">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">{ex.nameTr}</p>
          <p className="text-xs tabular-nums text-muted-foreground">
            {ex.sets} set × {ex.reps}
            {ex.restSeconds ? ` · ${ex.restSeconds} sn dinlenme` : ''}
            {ex.tempo ? ` · tempo ${ex.tempo}` : ''}
          </p>
          {ex.note ? <p className="mt-1 text-xs text-muted-foreground">{ex.note}</p> : null}
        </div>
        {ex.videoUrl ? (
          <a
            href={ex.videoUrl}
            target="_blank"
            rel="noreferrer"
            className="flex shrink-0 items-center gap-1 text-xs text-primary hover:underline"
          >
            <PlayCircleIcon className="size-4" /> Video
          </a>
        ) : null}
      </div>
      <Button variant="outline" size="sm" className="h-8" onClick={() => setFeedbackOpen(true)}>
        <MessageCircleIcon className="size-3.5" /> Geri bildirim ver
      </Button>

      {feedbackOpen ? (
        <FeedbackDialog
          exerciseName={ex.nameTr}
          programId={programId}
          programVersion={programVersion}
          dayOrder={dayOrder}
          exerciseId={ex.exerciseId}
          onClose={() => setFeedbackOpen(false)}
        />
      ) : null}
    </li>
  )
}

function FeedbackDialog({
  exerciseName,
  programId,
  programVersion,
  dayOrder,
  exerciseId,
  onClose,
}: {
  exerciseName: string
  programId: string
  programVersion: number
  dayOrder: number
  exerciseId: string
  onClose: () => void
}) {
  const router = useRouter()
  const [reason, setReason] = useState<FeedbackReason>('too_hard')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit() {
    if (message.trim().length === 0) {
      toast.error('Lütfen bir mesaj yazın.')
      return
    }
    setBusy(true)
    try {
      const res = await leaveFeedbackAction({ programId, programVersion, dayOrder, exerciseId, reason, message: message.trim() })
      if (res.ok) {
        toast.success('Geri bildirimin eğitmenine iletildi.')
        onClose()
        router.refresh()
      } else {
        toast.error(domainErrorMessage(res.error))
      }
    } catch {
      toast.error('Gönderilemedi.')
    }
    setBusy(false)
  }

  return (
    <Dialog open onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Geri bildirim — {exerciseName}</DialogTitle>
          <DialogDescription>Bu egzersizle ilgili eğitmenine bir not bırak.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">Sebep</span>
            <Select value={reason} onValueChange={(v) => v && setReason(v as FeedbackReason)}>
              <SelectTrigger>
                <SelectValue>{(v: unknown) => FEEDBACK_REASON_LABEL[v as FeedbackReason] ?? 'Sebep'}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {FEEDBACK_REASONS.map((r) => (
                  <SelectItem key={r} value={r}>
                    {FEEDBACK_REASON_LABEL[r]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <Textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={3} placeholder="Ne hissettin?" />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button onClick={() => void submit()} disabled={busy}>
            {busy ? <Loader2Icon className="animate-spin" /> : null} Gönder
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Gelişimim ────────────────────────────────────────────────────────────────────────────────────
function ProgressTab({ measurements, photos }: { measurements: readonly Measurement[]; photos: readonly PortalPhoto[] }) {
  if (measurements.length === 0 && photos.length === 0) {
    return (
      <EmptyState
        icon={ActivityIcon}
        title="Henüz kayıt yok"
        description="Eğitmenin ölçüm veya fotoğraf ekledikçe gelişimini burada takip edebileceksin."
      />
    )
  }
  return (
    <div className="space-y-5">
      {measurements.length > 0 ? (
        <section className="space-y-2">
          <h3 className="text-h3 font-semibold text-foreground">Ölçümlerim</h3>
          <div className="rounded-xl border border-border bg-card p-4 shadow-xs">
            <MeasurementChart measurements={measurements} />
          </div>
        </section>
      ) : null}

      {photos.length > 0 ? (
        <section className="space-y-2">
          <h3 className="text-h3 font-semibold text-foreground">Fotoğraflarım</h3>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {photos.map((p) => (
              <li key={p.id} className="overflow-hidden rounded-xl border border-border bg-card shadow-xs">
                <div className="relative aspect-square bg-muted">
                  {p.url ? (
                    <img src={p.url} alt={`${PHOTO_ANGLE_LABEL[p.angle]} — ${p.takenOn}`} className="size-full object-cover" />
                  ) : (
                    <div className="grid size-full place-items-center text-xs text-muted-foreground">önizleme yok</div>
                  )}
                  <span className="absolute left-1.5 top-1.5">
                    <Badge className="bg-background/85 text-foreground">{PHOTO_ANGLE_LABEL[p.angle]}</Badge>
                  </span>
                </div>
                <div className="p-2 text-xs text-muted-foreground">{p.takenOn}</div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}
