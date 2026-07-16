'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ActivityIcon,
  CameraIcon,
  DumbbellIcon,
  EyeIcon,
  EyeOffIcon,
  LayersIcon,
  Loader2Icon,
  PlusIcon,
  Trash2Icon,
  UploadIcon,
} from 'lucide-react'
import { toast } from 'sonner'

import type { Exercise, Measurement, Program, ProgramDay, ProgramTemplate } from '@studio/core'

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
import { Input } from '@/components/ui/input'
import { Section } from '@/components/ui/section'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import { ExerciseGuideDialog } from '@/components/exercise-guide-dialog'
import { MeasurementChart } from '@/components/training/measurement-chart'
import { domainErrorMessage } from '@/lib/domain-error'
import { PHOTO_ANGLE_LABEL, PROGRAM_STATUS_LABEL, PROGRAM_STATUS_TONE } from '@/lib/training-labels'
import { PhotoStorageUnconfiguredError, progressUploadConfigured, uploadProgressPhoto } from '@/lib/photo-upload'
import {
  addProgressPhotoAction,
  assignTemplateAction,
  changeProgramStatusAction,
  correctMeasurementAction,
  createProgramAction,
  listExercisesAction,
  listMemberMeasurementsAction,
  listMemberPhotosAction,
  listMemberProgramsAction,
  listProgramTemplatesAction,
  memberProgramStatusAction,
  publishProgramVersionAction,
  recordMeasurementAction,
  removeProgressPhotoAction,
} from '@/server/actions/training'

const LEVEL_LABEL: Record<string, string> = { beginner: 'Başlangıç', intermediate: 'Orta', advanced: 'İleri' }

const TZ = 'Europe/Istanbul'
const dtime = (ms: number) => new Date(ms).toLocaleString('tr-TR', { timeZone: TZ, dateStyle: 'medium', timeStyle: 'short' })
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ })

export function TrainingPanel({
  memberId,
  studioId,
  mode,
}: {
  memberId: string
  studioId: string
  mode: 'full' | 'boolean'
}) {
  if (mode === 'boolean') return <BooleanTrainingView memberId={memberId} />
  return <FullTrainingPanel memberId={memberId} studioId={studioId} />
}

// ── Reception: a boolean only — never a programme's content, never a photo (§13) ────────────────
function BooleanTrainingView({ memberId }: { memberId: string }) {
  const [status, setStatus] = useState<{ hasProgram: boolean; hasActive: boolean; hasExpired: boolean } | null>(null)

  useEffect(() => {
    memberProgramStatusAction({ memberId })
      .then(setStatus)
      .catch(() => setStatus(null))
  }, [memberId])

  return (
    <Section title="Antrenman" hint="Yalnızca durum">
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-4 shadow-xs">
        {status === null ? (
          <span className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2Icon className="size-4 animate-spin" /> Yükleniyor…
          </span>
        ) : status.hasActive ? (
          <Badge className="bg-success/10 text-success">Aktif program var</Badge>
        ) : status.hasProgram ? (
          <Badge className="bg-muted text-muted-foreground">Program var (aktif değil)</Badge>
        ) : (
          <Badge className="bg-muted text-muted-foreground">Program yok</Badge>
        )}
        <span className="text-xs text-muted-foreground">
          Program içeriği, ölçümler ve fotoğraflar yalnızca eğitmen ve sahip tarafından görülebilir.
        </span>
      </div>
    </Section>
  )
}

// ── Owner / trainer: the full workspace ─────────────────────────────────────────────────────────
function FullTrainingPanel({ memberId, studioId }: { memberId: string; studioId: string }) {
  return (
    <div className="space-y-6">
      <ProgramsSection memberId={memberId} />
      <MeasurementsSection memberId={memberId} />
      <PhotosSection memberId={memberId} studioId={studioId} />
    </div>
  )
}

// ── Programmes ──────────────────────────────────────────────────────────────────────────────────
function ProgramsSection({ memberId }: { memberId: string }) {
  const [programs, setPrograms] = useState<readonly Program[] | null>(null)
  const [exercises, setExercises] = useState<readonly Exercise[]>([])
  const [templates, setTemplates] = useState<readonly ProgramTemplate[]>([])
  const [creating, setCreating] = useState(false)
  const [assigning, setAssigning] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)

  const reload = useCallback(async () => {
    const [ps, ex, tps] = await Promise.all([listMemberProgramsAction({ memberId }), listExercisesAction(), listProgramTemplatesAction()])
    setPrograms(ps)
    setExercises(ex)
    setTemplates(tps)
  }, [memberId])

  useEffect(() => {
    void reload()
  }, [reload])

  const open = programs?.find((p) => p.id === openId) ?? null

  return (
    <Section
      title="Programlar"
      hint={programs ? `${programs.length}` : ''}
      actions={
        <div className="flex gap-1.5">
          {templates.length > 0 ? (
            <Button size="sm" variant="secondary" onClick={() => setAssigning(true)}>
              <LayersIcon /> Şablondan Ata
            </Button>
          ) : null}
          <Button size="sm" onClick={() => setCreating(true)}>
            <PlusIcon /> Program Oluştur
          </Button>
        </div>
      }
    >
      {programs === null ? (
        <Loading />
      ) : programs.length === 0 ? (
        <EmptyState
          icon={DumbbellIcon}
          title="Program yok"
          description="Bu üye için bir antrenman programı oluşturun. Program hiç silinmez; her değişiklik yeni bir sürümdür."
        />
      ) : (
        <ul className="space-y-2">
          {programs.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => setOpenId(p.id)}
                className="flex w-full items-center justify-between gap-3 rounded-xl border border-border bg-card p-3 text-left shadow-xs transition-colors hover:bg-muted/50"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{p.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {p.currentVersion > 0 ? `v${p.currentVersion} · ${p.versions.length} sürüm` : 'Henüz sürüm yayınlanmadı'}
                  </p>
                </div>
                <Badge className={PROGRAM_STATUS_TONE[p.status]}>{PROGRAM_STATUS_LABEL[p.status]}</Badge>
              </button>
            </li>
          ))}
        </ul>
      )}

      {creating ? (
        <CreateProgramDialog
          memberId={memberId}
          onClose={() => setCreating(false)}
          onCreated={async (id) => {
            setCreating(false)
            await reload()
            setOpenId(id)
          }}
        />
      ) : null}

      {assigning ? (
        <AssignTemplateDialog
          memberId={memberId}
          templates={templates}
          onClose={() => setAssigning(false)}
          onAssigned={async (id) => {
            setAssigning(false)
            await reload()
            setOpenId(id)
          }}
        />
      ) : null}

      {open ? (
        <ProgramDetailSheet
          program={open}
          exercises={exercises}
          onClose={() => setOpenId(null)}
          onChanged={reload}
        />
      ) : null}
    </Section>
  )
}

function AssignTemplateDialog({
  memberId,
  templates,
  onClose,
  onAssigned,
}: {
  memberId: string
  templates: readonly ProgramTemplate[]
  onClose: () => void
  onAssigned: (programId: string) => void
}) {
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? '')
  const [busy, setBusy] = useState(false)
  const chosen = templates.find((t) => t.id === templateId) ?? null

  async function submit() {
    if (!templateId) return
    setBusy(true)
    try {
      const r = await assignTemplateAction({ templateId, memberId })
      if (r && 'ok' in r && !r.ok) return void toast.error(domainErrorMessage(r.error))
      toast.success('Program şablondan oluşturuldu.')
      if (r && 'ok' in r && r.ok) onAssigned(r.value.id)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Şablondan program ata</DialogTitle>
          <DialogDescription>Bir program şablonu seçin — üye için o programı yeni bir program olarak oluşturur. Sonra üyeye özel düzenleyebilirsiniz.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Select value={templateId} onValueChange={(v) => setTemplateId(v ?? '')}>
            <SelectTrigger>
              <SelectValue placeholder="Şablon seç" />
            </SelectTrigger>
            <SelectContent>
              {templates.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name} · {LEVEL_LABEL[t.level] ?? t.level}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {chosen ? (
            <p className="text-xs text-muted-foreground">
              {chosen.days.length} gün · {chosen.days.reduce((n, d) => n + d.exercises.length, 0)} hareket
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Vazgeç
          </Button>
          <Button onClick={() => void submit()} disabled={busy || !templateId}>
            {busy ? <Loader2Icon className="size-4 animate-spin" /> : null} Ata
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function CreateProgramDialog({
  memberId,
  onClose,
  onCreated,
}: {
  memberId: string
  onClose: () => void
  onCreated: (programId: string) => void
}) {
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit() {
    if (title.trim().length === 0) {
      toast.error('Program adı zorunludur.')
      return
    }
    setBusy(true)
    try {
      const res = await createProgramAction({ memberId, title: title.trim() })
      if (res.ok) {
        toast.success('Program oluşturuldu. Şimdi ilk sürümü yayınlayın.')
        onCreated(res.value.id)
      } else {
        toast.error(domainErrorMessage(res.error))
      }
    } catch {
      toast.error('İşlem tamamlanamadı.')
    }
    setBusy(false)
  }

  return (
    <Dialog open onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Program Oluştur</DialogTitle>
          <DialogDescription>Adını verin; içeriği sürüm yayınlayarak eklersiniz.</DialogDescription>
        </DialogHeader>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="ör. Başlangıç — 3 gün" />
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button onClick={() => void submit()} disabled={busy}>
            {busy ? <Loader2Icon className="animate-spin" /> : null} Oluştur
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const STATUSES: readonly Program['status'][] = ['draft', 'active', 'completed', 'archived']

function ProgramDetailSheet({
  program,
  exercises,
  onClose,
  onChanged,
}: {
  program: Program
  exercises: readonly Exercise[]
  onClose: () => void
  onChanged: () => Promise<void>
}) {
  const [building, setBuilding] = useState(false)
  const [busy, setBusy] = useState(false)
  const [guide, setGuide] = useState<Exercise | null>(null)
  const latest = program.versions[program.versions.length - 1] ?? null

  async function setStatus(to: Program['status']) {
    setBusy(true)
    const res = await changeProgramStatusAction({ programId: program.id, to })
    setBusy(false)
    if (res.ok) {
      toast.success('Durum güncellendi.')
      await onChanged()
    } else {
      toast.error(domainErrorMessage(res.error))
    }
  }

  return (
    <Sheet open onOpenChange={(o) => (o ? null : onClose())}>
      <SheetContent side="right" className="w-full gap-4 overflow-y-auto p-4 sm:max-w-xl sm:p-5">
        <SheetHeader className="p-0">
          <SheetTitle className="text-h1">{program.title}</SheetTitle>
          <SheetDescription>
            {program.currentVersion > 0 ? `Güncel sürüm v${program.currentVersion}` : 'Henüz sürüm yok'}
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">Durum</span>
          <Select value={program.status} onValueChange={(v) => v && program.status !== v && void setStatus(v as Program['status'])}>
            <SelectTrigger className="h-8 w-40" disabled={busy}>
              <SelectValue>{(v: unknown) => PROGRAM_STATUS_LABEL[v as Program['status']] ?? 'Durum'}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {PROGRAM_STATUS_LABEL[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" className="ml-auto" onClick={() => setBuilding(true)} disabled={program.status === 'archived'}>
            <PlusIcon className="size-3.5" /> Yeni Sürüm
          </Button>
        </div>

        {/* Version history, newest first — every version read-only (§4/§6). */}
        <div className="space-y-3">
          {program.versions.length === 0 ? (
            <p className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">
              Bu programın henüz bir sürümü yok. "Yeni Sürüm" ile ilk günleri ve egzersizleri ekleyin.
            </p>
          ) : (
            [...program.versions]
              .sort((a, b) => b.version - a.version)
              .map((v) => (
                <div key={v.version} className="rounded-xl border border-border bg-card p-3 shadow-xs">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-sm font-medium text-foreground">
                      v{v.version}
                      {v.version === program.currentVersion ? (
                        <Badge className="ml-2 bg-success/10 text-success">Güncel</Badge>
                      ) : null}
                    </p>
                    <span className="text-xs text-muted-foreground">yayınlandı {dtime(v.publishedAt)}</span>
                  </div>
                  {v.note ? <p className="mt-1 text-xs text-muted-foreground">{v.note}</p> : null}
                  <div className="mt-2 space-y-2">
                    {v.days.map((day) => (
                      <div key={day.order} className="rounded-lg bg-muted/40 p-2">
                        <p className="text-xs font-medium text-foreground">{day.name}</p>
                        <ul className="mt-1 space-y-0.5">
                          {day.exercises.map((ex) => {
                            const lib = exercises.find((e) => e.id === ex.exerciseId)
                            return (
                              <li key={ex.order} className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground">
                                {lib ? (
                                  <button
                                    type="button"
                                    onClick={() => setGuide(lib)}
                                    title="Hareket rehberi"
                                    className="truncate text-left text-foreground hover:text-primary hover:underline"
                                  >
                                    {ex.nameTr}
                                  </button>
                                ) : (
                                  <span className="truncate text-foreground">{ex.nameTr}</span>
                                )}
                                <span className="shrink-0 tabular-nums">
                                  {ex.sets}×{ex.reps}
                                  {ex.restSeconds ? ` · ${ex.restSeconds}sn` : ''}
                                </span>
                              </li>
                            )
                          })}
                        </ul>
                      </div>
                    ))}
                  </div>
                </div>
              ))
          )}
        </div>

        {building ? (
          <ProgramBuilderSheet
            programId={program.id}
            exercises={exercises}
            seed={latest?.days ?? null}
            nextVersion={program.currentVersion + 1}
            onClose={() => setBuilding(false)}
            onPublished={async () => {
              setBuilding(false)
              await onChanged()
            }}
          />
        ) : null}
        {guide ? <ExerciseGuideDialog exercise={guide} onClose={() => setGuide(null)} /> : null}
      </SheetContent>
    </Sheet>
  )
}

// ── The program builder — draft days & exercises, publish a new version ─────────────────────────
interface DraftExercise {
  exerciseId: string
  sets: number
  reps: string
  restSeconds: number
  tempo: string
  note: string
  alternativeExerciseId: string | null
}
interface DraftDay {
  name: string
  exercises: DraftExercise[]
}

function seedDays(seed: readonly ProgramDay[] | null): DraftDay[] {
  if (!seed || seed.length === 0) return [{ name: 'Gün 1', exercises: [] }]
  return seed.map((d) => ({
    name: d.name,
    exercises: d.exercises.map((e) => ({
      exerciseId: e.exerciseId,
      sets: e.sets,
      reps: e.reps,
      restSeconds: e.restSeconds,
      tempo: e.tempo,
      note: e.note,
      alternativeExerciseId: e.alternativeExerciseId,
    })),
  }))
}

function ProgramBuilderSheet({
  programId,
  exercises,
  seed,
  nextVersion,
  onClose,
  onPublished,
}: {
  programId: string
  exercises: readonly Exercise[]
  seed: readonly ProgramDay[] | null
  nextVersion: number
  onClose: () => void
  onPublished: () => Promise<void>
}) {
  const [days, setDays] = useState<DraftDay[]>(() => seedDays(seed))
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const active = useMemo(() => exercises.filter((e) => e.active), [exercises])
  const nameOf = (id: string) => exercises.find((e) => e.id === id)?.nameTr ?? 'Egzersiz'

  const mutateDay = (di: number, fn: (d: DraftDay) => DraftDay) =>
    setDays((ds) => ds.map((d, i) => (i === di ? fn(d) : d)))

  function addExercise(di: number, exerciseId: string) {
    mutateDay(di, (d) => ({
      ...d,
      exercises: [...d.exercises, { exerciseId, sets: 3, reps: '12', restSeconds: 60, tempo: '', note: '', alternativeExerciseId: null }],
    }))
  }

  async function publish() {
    const payloadDays = days
      .map((d, i) => ({
        order: i + 1,
        name: d.name.trim() || `Gün ${i + 1}`,
        exercises: d.exercises.map((e, j) => ({
          exerciseId: e.exerciseId,
          order: j + 1,
          sets: e.sets,
          reps: e.reps.trim() || '1',
          restSeconds: e.restSeconds,
          tempo: e.tempo.trim(),
          note: e.note.trim(),
          alternativeExerciseId: e.alternativeExerciseId,
        })),
      }))
      .filter((d) => d.exercises.length > 0)

    if (payloadDays.length === 0) {
      toast.error('En az bir güne en az bir egzersiz ekleyin.')
      return
    }
    setBusy(true)
    try {
      const res = await publishProgramVersionAction({ programId, days: payloadDays, note: note.trim() })
      if (res.ok) {
        toast.success(`v${nextVersion} yayınlandı.`)
        await onPublished()
      } else {
        toast.error(domainErrorMessage(res.error))
      }
    } catch {
      toast.error('Yayınlanamadı.')
    }
    setBusy(false)
  }

  return (
    <Sheet open onOpenChange={(o) => (o ? null : onClose())}>
      <SheetContent side="right" className="w-full gap-4 overflow-y-auto p-4 sm:max-w-2xl sm:p-5">
        <SheetHeader className="p-0">
          <SheetTitle className="text-h1">Yeni Sürüm — v{nextVersion}</SheetTitle>
          <SheetDescription>
            Günleri ve egzersizleri düzenleyin. Yayınlanınca kütüphanedeki egzersizlerin o anki hali programa kopyalanır.
          </SheetDescription>
        </SheetHeader>

        {active.length === 0 ? (
          <p className="rounded-lg bg-warning/10 p-3 text-sm text-warning">
            Kütüphanede aktif egzersiz yok. Önce Antrenman → Egzersiz Kütüphanesi'nden egzersiz ekleyin.
          </p>
        ) : null}

        <div className="space-y-4">
          {days.map((day, di) => (
            <div key={di} className="space-y-2 rounded-xl border border-border bg-card p-3 shadow-xs">
              <div className="flex items-center gap-2">
                <Input
                  value={day.name}
                  onChange={(e) => mutateDay(di, (d) => ({ ...d, name: e.target.value }))}
                  placeholder={`Gün ${di + 1}`}
                  className="h-8"
                />
                {days.length > 1 ? (
                  <Button variant="ghost" size="sm" onClick={() => setDays((ds) => ds.filter((_, i) => i !== di))}>
                    <Trash2Icon className="size-3.5" />
                  </Button>
                ) : null}
              </div>

              {day.exercises.map((ex, ei) => (
                <div key={ei} className="space-y-2 rounded-lg bg-muted/40 p-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium text-foreground">{nameOf(ex.exerciseId)}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => mutateDay(di, (d) => ({ ...d, exercises: d.exercises.filter((_, j) => j !== ei) }))}
                    >
                      <Trash2Icon className="size-3.5" />
                    </Button>
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <NumField
                      label="Set"
                      value={ex.sets}
                      onChange={(n) => mutateDay(di, (d) => ({ ...d, exercises: d.exercises.map((x, j) => (j === ei ? { ...x, sets: n } : x)) }))}
                    />
                    <TextField
                      label="Tekrar"
                      value={ex.reps}
                      onChange={(v) => mutateDay(di, (d) => ({ ...d, exercises: d.exercises.map((x, j) => (j === ei ? { ...x, reps: v } : x)) }))}
                    />
                    <NumField
                      label="Dinlenme (sn)"
                      value={ex.restSeconds}
                      onChange={(n) => mutateDay(di, (d) => ({ ...d, exercises: d.exercises.map((x, j) => (j === ei ? { ...x, restSeconds: n } : x)) }))}
                    />
                    <TextField
                      label="Tempo"
                      value={ex.tempo}
                      onChange={(v) => mutateDay(di, (d) => ({ ...d, exercises: d.exercises.map((x, j) => (j === ei ? { ...x, tempo: v } : x)) }))}
                    />
                  </div>
                  <Input
                    value={ex.note}
                    onChange={(e) => mutateDay(di, (d) => ({ ...d, exercises: d.exercises.map((x, j) => (j === ei ? { ...x, note: e.target.value } : x)) }))}
                    placeholder="Not (opsiyonel)"
                    className="h-8"
                  />
                </div>
              ))}

              {active.length > 0 ? (
                <Select value="" onValueChange={(v) => v && addExercise(di, v)}>
                  <SelectTrigger className="h-8">
                    <SelectValue>{() => '+ Egzersiz ekle'}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {active.map((e) => (
                      <SelectItem key={e.id} value={e.id}>
                        {e.nameTr}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : null}
            </div>
          ))}

          <Button variant="outline" size="sm" onClick={() => setDays((ds) => [...ds, { name: `Gün ${ds.length + 1}`, exercises: [] }])}>
            <PlusIcon className="size-3.5" /> Gün Ekle
          </Button>

          <label className="flex flex-col gap-1 text-sm">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">Sürüm notu (opsiyonel)</span>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Bu sürümde ne değişti?" />
          </label>
        </div>

        <div className="flex justify-end gap-2 border-t border-border pt-3">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button onClick={() => void publish()} disabled={busy}>
            {busy ? <Loader2Icon className="animate-spin" /> : null} v{nextVersion} Yayınla
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}

// ── Measurements ────────────────────────────────────────────────────────────────────────────────
function MeasurementsSection({ memberId }: { memberId: string }) {
  const [rows, setRows] = useState<readonly Measurement[] | null>(null)
  const [recording, setRecording] = useState(false)
  const [correcting, setCorrecting] = useState<Measurement | null>(null)

  const reload = useCallback(async () => {
    setRows(await listMemberMeasurementsAction({ memberId }))
  }, [memberId])

  useEffect(() => {
    void reload()
  }, [reload])

  const ordered = useMemo(() => (rows ? [...rows].sort((a, b) => b.takenOn.localeCompare(a.takenOn)) : []), [rows])

  return (
    <Section
      title="Ölçümler"
      hint={rows ? `${rows.length}` : ''}
      actions={
        <Button size="sm" onClick={() => setRecording(true)}>
          <PlusIcon /> Ölçüm Ekle
        </Button>
      }
    >
      {rows === null ? (
        <Loading />
      ) : rows.length === 0 ? (
        <EmptyState icon={ActivityIcon} title="Ölçüm yok" description="Kilo, yağ oranı ve çevre ölçülerini zamanla takip edin." />
      ) : (
        <div className="space-y-4">
          <div className="rounded-xl border border-border bg-card p-4 shadow-xs">
            <MeasurementChart measurements={rows} />
          </div>
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card shadow-xs">
            {ordered.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">
                    {m.takenOn}
                    {m.correctedFrom ? <Badge className="ml-2 bg-warning/10 text-warning">Düzeltme</Badge> : null}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {[
                      m.weightKg != null ? `${m.weightKg} kg` : null,
                      m.fatPercent != null ? `Yağ %${m.fatPercent}` : null,
                      m.bmi != null ? `BMI ${m.bmi}` : null,
                    ]
                      .filter(Boolean)
                      .join(' · ') || 'Detay yok'}
                  </p>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setCorrecting(m)}>
                  Düzelt
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {recording ? (
        <MeasurementDialog
          memberId={memberId}
          correct={null}
          onClose={() => setRecording(false)}
          onSaved={async () => {
            setRecording(false)
            await reload()
          }}
        />
      ) : null}
      {correcting ? (
        <MeasurementDialog
          memberId={memberId}
          correct={correcting}
          onClose={() => setCorrecting(null)}
          onSaved={async () => {
            setCorrecting(null)
            await reload()
          }}
        />
      ) : null}
    </Section>
  )
}

const METRIC_FIELDS: readonly { key: 'weightKg' | 'fatPercent' | 'musclePercent' | 'waterPercent' | 'bmi' | 'bmr' | 'visceralFat'; label: string }[] = [
  { key: 'weightKg', label: 'Kilo (kg)' },
  { key: 'fatPercent', label: 'Yağ %' },
  { key: 'musclePercent', label: 'Kas %' },
  { key: 'waterPercent', label: 'Su %' },
  { key: 'bmi', label: 'BMI' },
  { key: 'bmr', label: 'BMR' },
  { key: 'visceralFat', label: 'Viseral yağ' },
]

interface CircRow {
  key: string
  value: string
}

function MeasurementDialog({
  memberId,
  correct,
  onClose,
  onSaved,
}: {
  memberId: string
  correct: Measurement | null
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const [takenOn, setTakenOn] = useState(correct?.takenOn ?? today())
  const [metrics, setMetrics] = useState<Record<string, string>>(() => {
    const seed: Record<string, string> = {}
    if (correct) for (const f of METRIC_FIELDS) if (correct[f.key] != null) seed[f.key] = String(correct[f.key])
    return seed
  })
  const [circ, setCirc] = useState<CircRow[]>(() =>
    correct ? Object.entries(correct.circumferences).map(([key, value]) => ({ key, value: String(value) })) : [],
  )
  const [note, setNote] = useState(correct?.note ?? '')
  const [busy, setBusy] = useState(false)

  const num = (s: string | undefined): number | null => {
    if (s == null || s.trim() === '') return null
    const n = Number(s)
    return Number.isFinite(n) ? n : null
  }

  async function submit() {
    if (correct && note.trim().length === 0) {
      toast.error('Düzeltme için not zorunludur.')
      return
    }
    const circumferences: Record<string, number> = {}
    for (const r of circ) {
      const n = num(r.value)
      if (r.key.trim() && n != null) circumferences[r.key.trim()] = n
    }
    const base = {
      memberId,
      takenOn,
      weightKg: num(metrics.weightKg),
      fatPercent: num(metrics.fatPercent),
      musclePercent: num(metrics.musclePercent),
      waterPercent: num(metrics.waterPercent),
      bmi: num(metrics.bmi),
      bmr: num(metrics.bmr),
      visceralFat: num(metrics.visceralFat),
      circumferences,
      note: note.trim(),
    }
    setBusy(true)
    try {
      const res = correct
        ? await correctMeasurementAction({ ...base, correctedFrom: correct.id })
        : await recordMeasurementAction(base)
      if (res.ok) {
        toast.success(correct ? 'Ölçüm düzeltildi.' : 'Ölçüm kaydedildi.')
        await onSaved()
      } else {
        toast.error(domainErrorMessage(res.error))
      }
    } catch {
      toast.error('İşlem tamamlanamadı.')
    }
    setBusy(false)
  }

  return (
    <Dialog open onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{correct ? 'Ölçümü Düzelt' : 'Ölçüm Ekle'}</DialogTitle>
          <DialogDescription>
            {correct
              ? 'Düzeltme eski kaydı silmez; yeni bir kayıt olarak eklenir ve öncekine bağlanır.'
              : 'Yalnızca girdiğiniz alanlar kaydedilir. Değerler üyeye özeldir ve olay kaydına girmez.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">Tarih</span>
            <Input type="date" value={takenOn} onChange={(e) => setTakenOn(e.target.value)} />
          </label>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {METRIC_FIELDS.map((f) => (
              <label key={f.key} className="flex flex-col gap-1 text-sm">
                <span className="text-xs text-muted-foreground">{f.label}</span>
                <Input
                  type="number"
                  inputMode="decimal"
                  value={metrics[f.key] ?? ''}
                  onChange={(e) => setMetrics((m) => ({ ...m, [f.key]: e.target.value }))}
                />
              </label>
            ))}
          </div>

          <div className="space-y-2">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Çevre ölçüleri (cm)</p>
            {circ.map((r, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input
                  value={r.key}
                  onChange={(e) => setCirc((c) => c.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))}
                  placeholder="Bölge (ör. Bel)"
                  className="h-9"
                />
                <Input
                  type="number"
                  inputMode="decimal"
                  value={r.value}
                  onChange={(e) => setCirc((c) => c.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
                  placeholder="cm"
                  className="h-9 w-24"
                />
                <Button variant="ghost" size="sm" onClick={() => setCirc((c) => c.filter((_, j) => j !== i))}>
                  <Trash2Icon className="size-3.5" />
                </Button>
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={() => setCirc((c) => [...c, { key: '', value: '' }])}>
              <PlusIcon className="size-3.5" /> Bölge ekle
            </Button>
          </div>

          <label className="flex flex-col gap-1 text-sm">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">
              Not {correct ? '(zorunlu)' : '(opsiyonel)'}
            </span>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
          </label>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button onClick={() => void submit()} disabled={busy}>
            {busy ? <Loader2Icon className="animate-spin" /> : null} Kaydet
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Progress photos ─────────────────────────────────────────────────────────────────────────────
interface PhotoRow {
  id: string
  takenOn: string
  angle: 'front' | 'side' | 'back'
  note: string
  memberVisible: boolean
  url: string | null
}

function PhotosSection({ memberId, studioId }: { memberId: string; studioId: string }) {
  const [rows, setRows] = useState<readonly PhotoRow[] | null>(null)
  const [filter, setFilter] = useState<'all' | 'front' | 'side' | 'back'>('all')
  const [uploading, setUploading] = useState(false)

  const reload = useCallback(async () => {
    setRows((await listMemberPhotosAction({ memberId })) as PhotoRow[])
  }, [memberId])

  useEffect(() => {
    void reload()
  }, [reload])

  const shown = (rows ?? []).filter((p) => filter === 'all' || p.angle === filter)

  return (
    <Section
      title="Fotoğraflar"
      hint={rows ? `${rows.length}` : ''}
      actions={
        <Button size="sm" onClick={() => setUploading(true)}>
          <UploadIcon /> Fotoğraf Ekle
        </Button>
      }
    >
      {rows === null ? (
        <Loading />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={CameraIcon}
          title="Fotoğraf yok"
          description="İlerleme fotoğrafları özel alanda saklanır; bağlantı kısa ömürlüdür ve asla herkese açık olmaz."
        />
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-1.5">
            {(['all', 'front', 'side', 'back'] as const).map((a) => (
              <button
                key={a}
                type="button"
                onClick={() => setFilter(a)}
                className={`min-h-8 rounded-lg border px-2.5 text-xs font-medium transition-colors ${
                  filter === a
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border bg-card text-muted-foreground hover:bg-muted'
                }`}
              >
                {a === 'all' ? 'Tümü' : PHOTO_ANGLE_LABEL[a]}
              </button>
            ))}
          </div>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {shown.map((p) => (
              <PhotoCard key={p.id} p={p} onChanged={reload} />
            ))}
          </ul>
        </div>
      )}

      {uploading ? (
        <PhotoUploadDialog
          memberId={memberId}
          studioId={studioId}
          onClose={() => setUploading(false)}
          onUploaded={async () => {
            setUploading(false)
            await reload()
          }}
        />
      ) : null}
    </Section>
  )
}

function PhotoCard({ p, onChanged }: { p: PhotoRow; onChanged: () => Promise<void> }) {
  const [removing, setRemoving] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  async function remove() {
    if (reason.trim().length === 0) {
      toast.error('Silme sebebi zorunludur.')
      return
    }
    setBusy(true)
    const res = await removeProgressPhotoAction({ photoId: p.id, reason: reason.trim() })
    setBusy(false)
    if (res.ok) {
      toast.success('Fotoğraf kaldırıldı.')
      setRemoving(false)
      await onChanged()
    } else {
      toast.error(domainErrorMessage(res.error))
    }
  }

  return (
    <li className="overflow-hidden rounded-xl border border-border bg-card shadow-xs">
      <div className="relative aspect-square bg-muted">
        {p.url ? (
          <img src={p.url} alt={`${PHOTO_ANGLE_LABEL[p.angle]} — ${p.takenOn}`} className="size-full object-cover" />
        ) : (
          <div className="grid size-full place-items-center text-xs text-muted-foreground">önizleme yok</div>
        )}
        <span className="absolute left-1.5 top-1.5">
          <Badge className="bg-background/85 text-foreground">{PHOTO_ANGLE_LABEL[p.angle]}</Badge>
        </span>
        <span className="absolute right-1.5 top-1.5">
          {p.memberVisible ? (
            <Badge className="gap-1 bg-success/15 text-success">
              <EyeIcon className="size-3" /> Üye
            </Badge>
          ) : (
            <Badge className="gap-1 bg-muted text-muted-foreground">
              <EyeOffIcon className="size-3" /> Gizli
            </Badge>
          )}
        </span>
      </div>
      <div className="flex items-center justify-between gap-2 p-2">
        <span className="truncate text-xs text-muted-foreground">{p.takenOn}</span>
        <Button variant="ghost" size="sm" className="text-danger" onClick={() => setRemoving(true)}>
          <Trash2Icon className="size-3.5" />
        </Button>
      </div>

      <Dialog open={removing} onOpenChange={(o) => (o ? null : setRemoving(false))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Fotoğrafı kaldır?</DialogTitle>
            <DialogDescription>Kayıt denetim için tutulur. Sebep zorunludur.</DialogDescription>
          </DialogHeader>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Sebep" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoving(false)} disabled={busy}>
              Vazgeç
            </Button>
            <Button variant="destructive" onClick={() => void remove()} disabled={busy}>
              {busy ? <Loader2Icon className="animate-spin" /> : null} Kaldır
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </li>
  )
}

function PhotoUploadDialog({
  memberId,
  studioId,
  onClose,
  onUploaded,
}: {
  memberId: string
  studioId: string
  onClose: () => void
  onUploaded: () => Promise<void>
}) {
  const [file, setFile] = useState<File | null>(null)
  const [angle, setAngle] = useState<'front' | 'side' | 'back'>('front')
  const [takenOn, setTakenOn] = useState(today())
  const [note, setNote] = useState('')
  const [memberVisible, setMemberVisible] = useState(false)
  const [busy, setBusy] = useState(false)
  const configured = progressUploadConfigured()

  async function submit() {
    if (!file) {
      toast.error('Bir fotoğraf seçin.')
      return
    }
    setBusy(true)
    try {
      const storagePath = await uploadProgressPhoto({ studioId, memberId, file })
      const res = await addProgressPhotoAction({ memberId, takenOn, angle, storagePath, note: note.trim(), memberVisible })
      if (res.ok) {
        toast.success('Fotoğraf eklendi.')
        await onUploaded()
      } else {
        toast.error(domainErrorMessage(res.error))
      }
    } catch (e) {
      if (e instanceof PhotoStorageUnconfiguredError) {
        toast.error('Fotoğraf yükleme yapılandırılmamış.')
      } else {
        toast.error('Yükleme başarısız.')
      }
    }
    setBusy(false)
  }

  return (
    <Dialog open onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Fotoğraf Ekle</DialogTitle>
          <DialogDescription>Fotoğraf özel alana yüklenir; üyeye göstermeyi siz seçersiniz.</DialogDescription>
        </DialogHeader>

        {!configured ? (
          <p className="rounded-lg bg-warning/10 p-3 text-sm text-warning">
            Fotoğraf yükleme bu ortamda yapılandırılmamış (Storage bucket tanımlı değil).
          </p>
        ) : null}

        <div className="space-y-3">
          <Input type="file" accept="image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} disabled={!configured} />
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-xs text-muted-foreground">Açı</span>
              <Select value={angle} onValueChange={(v) => v && setAngle(v as 'front' | 'side' | 'back')}>
                <SelectTrigger className="h-9">
                  <SelectValue>{(v: unknown) => PHOTO_ANGLE_LABEL[v as 'front' | 'side' | 'back'] ?? 'Açı'}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {(['front', 'side', 'back'] as const).map((a) => (
                    <SelectItem key={a} value={a}>
                      {PHOTO_ANGLE_LABEL[a]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-xs text-muted-foreground">Tarih</span>
              <Input type="date" value={takenOn} onChange={(e) => setTakenOn(e.target.value)} />
            </label>
          </div>
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Not (opsiyonel)" />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={memberVisible} onChange={(e) => setMemberVisible(e.target.checked)} className="size-4" />
            Üye kendi portalından görebilsin
          </label>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button onClick={() => void submit()} disabled={busy || !configured}>
            {busy ? <Loader2Icon className="animate-spin" /> : null} Yükle
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── shared ──────────────────────────────────────────────────────────────────────────────────────
function Loading() {
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <Loader2Icon className="size-4 animate-spin" /> Yükleniyor…
    </div>
  )
}

function NumField({ label, value, onChange }: { label: string; value: number; onChange: (n: number) => void }) {
  return (
    <label className="flex flex-col gap-0.5 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <Input
        type="number"
        inputMode="numeric"
        value={value}
        onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))}
        className="h-8"
      />
    </label>
  )
}

function TextField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex flex-col gap-0.5 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <Input value={value} onChange={(e) => onChange(e.target.value)} className="h-8" />
    </label>
  )
}
