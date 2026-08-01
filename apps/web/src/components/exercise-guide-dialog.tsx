'use client'

import { useState, type ReactNode } from 'react'
import { AlertTriangleIcon, CheckCircle2Icon, ClipboardListIcon, PencilIcon, PlayCircleIcon, TargetIcon, XCircleIcon } from 'lucide-react'

import { guideLines, parseGuideTargets } from '@studio/core/client'

import { MuscleMap, type Muscle } from '@/components/muscle-map'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogTitle } from '@/components/ui/dialog'
import { VideoDialog } from '@/components/video-dialog'
import { EXERCISE_MUSCLES } from '@/lib/exercise-muscles'

// The guidance fields the dialog reads — a subset of the full Exercise, so the same component serves the
// library (a full Exercise, which is assignable) AND the portal (a light object fetched for the member).
export interface ExerciseGuide {
  readonly nameTr: string
  readonly muscleGroup: string
  readonly equipment: string
  readonly description: string
  readonly tips: string
  readonly commonMistakes: string
  readonly videoUrl: string | null
  readonly photoUrl: string | null
  readonly gifUrl: string | null
  // Resolved server-side for the member's clients (2026-08-01), so the mobile app can draw the same
  // diagram without carrying the table. Absent when the caller IS the library — a staff Exercise has
  // no such fields — and the local lookup below still answers there.
  readonly primaryMuscles?: readonly string[]
  readonly secondaryMuscles?: readonly string[]
}

// The description convention and the line splitting moved to `@studio/core/client` when the mobile
// app grew the same guide (2026-08-01): two renderers of one format need one parser, or they drift.

// "Hareket Rehberi" as an INFOGRAPHIC (PF-11) — target muscles (ANA/İKİNCİL/ZAYIF, colour-coded), the
// movement summary, the correct movement (photos + cues) and the wrong movement (common mistakes). One
// component, used in the library, the member's program (staff) and the portal. `onEdit` only in the library.
export function ExerciseGuideDialog({
  exercise,
  onClose,
  onEdit,
}: {
  exercise: ExerciseGuide
  onClose: () => void
  onEdit?: () => void
}) {
  const ex = exercise
  const [videoOpen, setVideoOpen] = useState(false)
  const t = parseGuideTargets(ex.description)
  const images = [ex.photoUrl, ex.gifUrl].filter((u): u is string => Boolean(u))
  const tips = guideLines(ex.tips)
  const mistakes = guideLines(ex.commonMistakes)
  const hasTargets = Boolean(t.ana || t.ikincil || t.zayif || t.note)
  // The payload's answer wins where it exists (the member's clients), and the table answers for the
  // library, where the caller is a raw Exercise. One diagram, two sources, same picture.
  const muscles =
    ex.primaryMuscles || ex.secondaryMuscles
      ? { primary: (ex.primaryMuscles ?? []) as Muscle[], secondary: (ex.secondaryMuscles ?? []) as Muscle[] }
      : EXERCISE_MUSCLES[ex.nameTr]

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-xl">
        {/* Title band */}
        <div className="-mx-6 -mt-6 mb-1 bg-foreground px-6 py-4 text-background">
          <DialogTitle className="text-center text-xl font-bold tracking-tight uppercase">{ex.nameTr}</DialogTitle>
          {ex.muscleGroup || ex.equipment ? (
            <p className="mt-0.5 text-center text-xs text-background/70">{[ex.muscleGroup, ex.equipment].filter(Boolean).join(' · ')}</p>
          ) : null}
        </div>

        <div className="space-y-5">
          {/* HEDEF KAS GRUPLARI */}
          {hasTargets || muscles ? (
            <section>
              <SectionTitle icon={<TargetIcon className="size-4" />}>Hedef Kas Grupları</SectionTitle>
              <div className="mt-2 flex flex-col items-center gap-3 sm:flex-row sm:items-center">
                {muscles ? (
                  <div className="w-full max-w-[16rem] sm:w-1/2">
                    <MuscleMap primary={muscles.primary} secondary={muscles.secondary} />
                  </div>
                ) : null}
                <ul className="w-full space-y-1.5 sm:flex-1">
                  {t.ana ? <Target color="#d62828" label="Ana Hedef" value={t.ana} /> : null}
                  {t.ikincil ? <Target color="#f0a1a1" label="İkincil Hedef" value={t.ikincil} /> : null}
                  {t.zayif ? <Target color="#f9c0c0" label="Zayıf Etki" value={t.zayif} /> : null}
                  {t.note ? <li className="text-xs text-muted-foreground">{t.note}</li> : null}
                </ul>
              </div>
            </section>
          ) : null}

          {/* HAREKETİN ÖZETİ */}
          {t.summary ? (
            <section>
              <SectionTitle icon={<ClipboardListIcon className="size-4" />}>Hareketin Özeti</SectionTitle>
              <p className="mt-1.5 whitespace-pre-line text-sm leading-relaxed text-foreground">{t.summary}</p>
            </section>
          ) : null}

          {/* DOĞRU HAREKET — photos + cues */}
          {images.length > 0 || tips.length > 0 ? (
            <section className="rounded-xl border border-success/30 bg-success/5 p-3">
              <SectionTitle icon={<CheckCircle2Icon className="size-4 text-success" />}>Doğru Hareket</SectionTitle>
              {images.length > 0 ? (
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {images.map((src) => (
                    <img key={src} src={src} alt={ex.nameTr} className="w-full rounded-lg border border-border object-cover" />
                  ))}
                </div>
              ) : null}
              {tips.length > 0 ? (
                <ul className="mt-2 space-y-1">
                  {tips.map((l) => (
                    <li key={l} className="flex gap-1.5 text-sm text-foreground">
                      <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-success" />
                      {l}
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          ) : null}

          {/* YANLIŞ HAREKET — common mistakes */}
          {mistakes.length > 0 ? (
            <section className="rounded-xl border border-destructive/30 bg-destructive/5 p-3">
              <SectionTitle icon={<XCircleIcon className="size-4 text-destructive" />}>Yanlış Hareket</SectionTitle>
              <ul className="mt-2 space-y-1">
                {mistakes.map((l) => (
                  <li key={l} className="flex gap-1.5 text-sm text-foreground">
                    <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0 text-destructive" />
                    {l}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {/* Plays over the guide, not in another tab (owner, 2026-08-01) — she keeps her place. */}
          {ex.videoUrl ? (
            <Button variant="outline" onClick={() => setVideoOpen(true)}>
              <PlayCircleIcon className="size-4" /> Videoyu izle
            </Button>
          ) : null}

          {!hasTargets && !t.summary && images.length === 0 && tips.length === 0 && mistakes.length === 0 && !ex.videoUrl ? (
            <p className="text-sm text-muted-foreground">Bu hareket için henüz rehber girilmemiş.</p>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Kapat
          </Button>
          {onEdit ? (
            <Button onClick={onEdit}>
              <PencilIcon className="size-3.5" /> Düzenle
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>

      {videoOpen && ex.videoUrl ? (
        <VideoDialog url={ex.videoUrl} title={ex.nameTr} onClose={() => setVideoOpen(false)} />
      ) : null}
    </Dialog>
  )
}

function SectionTitle({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <h3 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-muted-foreground">
      {icon}
      {children}
    </h3>
  )
}

function Target({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <li className="flex items-baseline gap-2">
      <span className="mt-1 size-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
      <span className="text-xs font-semibold uppercase tracking-wide" style={{ color }}>
        {label}
      </span>
      <span className="text-sm text-foreground">{value}</span>
    </li>
  )
}
