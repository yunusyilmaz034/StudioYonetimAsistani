'use client'

import type { ReactNode } from 'react'
import { AlertTriangleIcon, CheckCircle2Icon, ClipboardListIcon, PencilIcon, PlayCircleIcon, TargetIcon, XCircleIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogTitle } from '@/components/ui/dialog'

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

// Parse the "🎯 Ana: … · İkincil: … · Zayıf: …" first line of the description into structured targets.
function parseTargets(description: string): {
  ana: string | null
  ikincil: string | null
  zayif: string | null
  note: string | null
  summary: string
} {
  const [head, ...rest] = description.split('\n\n')
  const summary = rest.join('\n\n').trim()
  if (!head?.trim().startsWith('🎯')) return { ana: null, ikincil: null, zayif: null, note: null, summary: description.trim() }
  const segs = head.replace('🎯', '').split('·').map((s) => s.trim()).filter(Boolean)
  let ana: string | null = null
  let ikincil: string | null = null
  let zayif: string | null = null
  let note: string | null = null
  for (const s of segs) {
    if (/^Ana\s*:/i.test(s)) ana = s.replace(/^Ana\s*:/i, '').trim()
    else if (/^İkincil\s*:/i.test(s)) ikincil = s.replace(/^İkincil\s*:/i, '').trim()
    else if (/^Zayıf\s*:/i.test(s)) zayif = s.replace(/^Zayıf\s*:/i, '').trim()
    else note = s
  }
  return { ana, ikincil, zayif, note, summary }
}

const lines = (s: string) => s.split('\n').map((l) => l.trim()).filter(Boolean)

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
  const t = parseTargets(ex.description)
  const images = [ex.photoUrl, ex.gifUrl].filter((u): u is string => Boolean(u))
  const tips = lines(ex.tips)
  const mistakes = lines(ex.commonMistakes)
  const hasTargets = Boolean(t.ana || t.ikincil || t.zayif || t.note)

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
          {hasTargets ? (
            <section>
              <SectionTitle icon={<TargetIcon className="size-4" />}>Hedef Kas Grupları</SectionTitle>
              <ul className="mt-2 space-y-1.5">
                {t.ana ? <Target color="#dc2626" label="Ana Hedef" value={t.ana} /> : null}
                {t.ikincil ? <Target color="#f59e0b" label="İkincil Hedef" value={t.ikincil} /> : null}
                {t.zayif ? <Target color="#f9a8d4" label="Zayıf Etki" value={t.zayif} /> : null}
                {t.note ? <li className="text-xs text-muted-foreground">{t.note}</li> : null}
              </ul>
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
