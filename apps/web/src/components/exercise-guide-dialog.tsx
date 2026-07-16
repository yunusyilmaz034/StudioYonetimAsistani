'use client'

import { PencilIcon, PlayCircleIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

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
}

// Read-only "Hareket Rehberi" (PF-11) — one component, used wherever an exercise is shown: the library,
// the member's program (staff), and the portal. It reads the guidance the exercise already stores
// (muscle group, açıklama, ipuçları, sık hatalar, video[, görsel]). Empty sections are hidden; a fully
// empty exercise says so. `onEdit` is optional — only the library offers it.
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
  const sections: { title: string; body: string }[] = [
    { title: 'Açıklama', body: ex.description },
    { title: 'İpuçları', body: ex.tips },
    { title: 'Sık Yapılan Hatalar', body: ex.commonMistakes },
  ].filter((s) => s.body.trim().length > 0)
  const images = [ex.photoUrl, ex.gifUrl].filter((u): u is string => Boolean(u))
  const empty = sections.length === 0 && !ex.videoUrl && images.length === 0

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{ex.nameTr}</DialogTitle>
          {ex.muscleGroup || ex.equipment ? (
            <DialogDescription>{[ex.muscleGroup, ex.equipment].filter(Boolean).join(' · ')}</DialogDescription>
          ) : null}
        </DialogHeader>
        <div className="space-y-4">
          {images.length > 0 ? (
            <div className="grid grid-cols-2 gap-2">
              {images.map((src) => (
                <img key={src} src={src} alt={ex.nameTr} className="w-full rounded-lg border border-border object-cover" />
              ))}
            </div>
          ) : null}
          {ex.videoUrl ? (
            <a
              href={ex.videoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-primary underline"
            >
              <PlayCircleIcon className="size-4" /> Videoyu izle
            </a>
          ) : null}
          {sections.map((s) => (
            <div key={s.title}>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{s.title}</p>
              <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-foreground">{s.body}</p>
            </div>
          ))}
          {empty ? (
            <p className="text-sm text-muted-foreground">
              Bu hareket için henüz rehber girilmemiş. Egzersiz kütüphanesinden açıklama, ipuçları ve sık yapılan
              hatalar eklenebilir.
            </p>
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
    </Dialog>
  )
}
