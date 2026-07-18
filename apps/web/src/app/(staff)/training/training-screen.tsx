'use client'

import { useState } from 'react'
import { DumbbellIcon, LayersIcon, Loader2Icon, MessageCircleIcon, PencilIcon, PlusIcon, SendIcon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'

import type { Exercise, ProgramTemplate, TrainingFeedback } from '@studio/core'

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
import { PageHeader } from '@/components/ui/page-header'
import { Section } from '@/components/ui/section'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { ExerciseGuideDialog } from '@/components/exercise-guide-dialog'
import { domainErrorMessage } from '@/lib/domain-error'
import { FEEDBACK_REASON_LABEL, FEEDBACK_REASON_TONE, FEEDBACK_STATUS_LABEL } from '@/lib/training-labels'
import {
  answerFeedbackAction,
  deactivateExerciseAction,
  deleteProgramTemplateAction,
  listExercisesAction,
  listOpenFeedbackAction,
  listProgramTemplatesAction,
  resolveFeedbackAction,
  upsertExerciseAction,
  upsertProgramTemplateAction,
} from '@/server/actions/training'

const LEVEL_LABEL: Record<string, string> = { beginner: 'Başlangıç', intermediate: 'Orta', advanced: 'İleri' }

const TZ = 'Europe/Istanbul'
const dt = (ms: number) => new Date(ms).toLocaleString('tr-TR', { timeZone: TZ, dateStyle: 'medium', timeStyle: 'short' })

export function TrainingScreen({
  initialExercises,
  initialFeedback,
  memberNames,
  initialTemplates,
}: {
  initialExercises: readonly Exercise[]
  initialFeedback: readonly TrainingFeedback[]
  memberNames: Readonly<Record<string, string>>
  initialTemplates: readonly ProgramTemplate[]
}) {
  const openCount = initialFeedback.filter((f) => f.status !== 'resolved').length
  return (
    <main className="mx-auto max-w-5xl space-y-5 p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="Antrenman"
        description="Egzersiz kütüphanesi, program şablonları ve üye geri bildirimleri. Üye programları, ölçümleri ve fotoğrafları üye kartından yönetilir."
      />
      <Tabs defaultValue="library">
        <TabsList className="flex w-full">
          <TabsTrigger value="library" className="min-h-9 flex-1">
            <DumbbellIcon className="size-4" />
            <span className="hidden sm:inline">Egzersiz Kütüphanesi</span>
            <span className="sm:hidden">Kütüphane</span>
          </TabsTrigger>
          <TabsTrigger value="templates" className="min-h-9 flex-1">
            <LayersIcon className="size-4" />
            <span className="hidden sm:inline">Program Şablonları</span>
            <span className="sm:hidden">Şablonlar</span>
          </TabsTrigger>
          <TabsTrigger value="feedback" className="min-h-9 flex-1">
            <MessageCircleIcon className="size-4" />
            <span className="hidden sm:inline">Geri Bildirim Merkezi</span>
            <span className="sm:hidden">Geri Bildirim</span>
            {openCount > 0 ? <Badge className="bg-danger/10 text-danger">{openCount}</Badge> : null}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="library">
          <ExerciseLibrary initial={initialExercises} />
        </TabsContent>
        <TabsContent value="templates">
          <TemplatesManager initial={initialTemplates} exercises={initialExercises} />
        </TabsContent>
        <TabsContent value="feedback">
          <FeedbackCenter
            initial={initialFeedback}
            memberNames={memberNames}
            exerciseNames={Object.fromEntries(initialExercises.map((e) => [e.id, e.nameTr]))}
          />
        </TabsContent>
      </Tabs>
    </main>
  )
}

// ── Program templates ────────────────────────────────────────────────────────────────────────
type DraftItem = { exerciseId: string; sets: number; reps: string }
type DraftDay = { name: string; items: DraftItem[] }

function TemplatesManager({ initial, exercises }: { initial: readonly ProgramTemplate[]; exercises: readonly Exercise[] }) {
  const [templates, setTemplates] = useState<readonly ProgramTemplate[]>(initial)
  const [editing, setEditing] = useState<ProgramTemplate | null>(null)
  const [creating, setCreating] = useState(false)

  async function reload() {
    setTemplates(await listProgramTemplatesAction())
  }
  async function remove(t: ProgramTemplate) {
    if (!confirm(`"${t.name}" şablonu silinsin mi?`)) return
    const r = await deleteProgramTemplateAction({ id: t.id })
    if (r && 'ok' in r && !r.ok) {
      toast.error(domainErrorMessage(r.error))
      return
    }
    toast.success('Şablon silindi.')
    await reload()
  }

  return (
    <Section
      title="Program Şablonları"
      hint={`${templates.length} şablon`}
      actions={
        <Button size="sm" onClick={() => setCreating(true)}>
          <PlusIcon /> Şablon Ekle
        </Button>
      }
    >
      {exercises.length === 0 ? (
        <EmptyState icon={LayersIcon} title="Önce egzersiz ekleyin" description="Şablon oluşturmak için egzersiz kütüphanesinde en az bir hareket olmalı." />
      ) : templates.length === 0 ? (
        <EmptyState
          icon={LayersIcon}
          title="Henüz şablon yok"
          description="Stüdyonun standart programlarını şablon olarak oluşturun (Program A gibi). Sonra üye kartından tek tıkla atarsınız."
          action={
            <Button size="sm" onClick={() => setCreating(true)}>
              <PlusIcon /> Şablon Ekle
            </Button>
          }
        />
      ) : (
        <ul className="grid gap-2">
          {templates.map((t) => (
            <li key={t.id} className="flex items-start justify-between gap-3 rounded-xl border border-border bg-card p-3 shadow-xs">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium text-foreground">
                  {t.name}
                  <Badge className="bg-primary/10 text-primary">{LEVEL_LABEL[t.level] ?? t.level}</Badge>
                  {!t.active ? <Badge className="bg-muted text-muted-foreground">Pasif</Badge> : null}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {t.days.length} gün · {t.days.reduce((n, d) => n + d.exercises.length, 0)} hareket
                </p>
              </div>
              <div className="flex shrink-0 gap-1">
                <Button variant="ghost" size="sm" onClick={() => setEditing(t)}>
                  <PencilIcon className="size-3.5" />
                </Button>
                <Button variant="ghost" size="sm" onClick={() => void remove(t)}>
                  <Trash2Icon className="size-3.5 text-danger" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {creating || editing ? (
        <TemplateDialog
          initial={editing}
          exercises={exercises}
          onClose={() => {
            setCreating(false)
            setEditing(null)
          }}
          onSaved={async () => {
            setCreating(false)
            setEditing(null)
            await reload()
          }}
        />
      ) : null}
    </Section>
  )
}

function TemplateDialog({
  initial,
  exercises,
  onClose,
  onSaved,
}: {
  initial: ProgramTemplate | null
  exercises: readonly Exercise[]
  onClose: () => void
  onSaved: () => void
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [level, setLevel] = useState(initial?.level ?? 'beginner')
  const [days, setDays] = useState<DraftDay[]>(
    initial
      ? initial.days.map((d) => ({ name: d.name, items: d.exercises.map((x) => ({ exerciseId: x.exerciseId, sets: x.sets, reps: x.reps })) }))
      : [{ name: 'Gün 1', items: [] }],
  )
  const [busy, setBusy] = useState(false)
  const active = exercises.filter((e) => e.active)

  function addDay() {
    setDays((d) => [...d, { name: `Gün ${d.length + 1}`, items: [] }])
  }
  function removeDay(di: number) {
    setDays((d) => d.filter((_, i) => i !== di).map((day, i) => ({ ...day, name: `Gün ${i + 1}` })))
  }
  function addItem(di: number) {
    setDays((d) => d.map((day, i) => (i === di ? { ...day, items: [...day.items, { exerciseId: active[0]?.id ?? '', sets: 3, reps: '12' }] } : day)))
  }
  function setItem(di: number, xi: number, patch: Partial<DraftItem>) {
    setDays((d) => d.map((day, i) => (i === di ? { ...day, items: day.items.map((it, j) => (j === xi ? { ...it, ...patch } : it)) } : day)))
  }
  function removeItem(di: number, xi: number) {
    setDays((d) => d.map((day, i) => (i === di ? { ...day, items: day.items.filter((_, j) => j !== xi) } : day)))
  }

  async function submit() {
    if (name.trim().length === 0) {
      toast.error('Şablon adı zorunludur.')
      return
    }
    if (days.every((d) => d.items.length === 0)) {
      toast.error('En az bir güne hareket ekleyin.')
      return
    }
    setBusy(true)
    try {
      const payload = {
        id: initial?.id,
        name: name.trim(),
        level,
        days: days
          .filter((d) => d.items.length > 0)
          .map((d, di) => ({
            order: di + 1,
            name: d.name,
            exercises: d.items
              .filter((it) => it.exerciseId)
              .map((it, xi) => ({ exerciseId: it.exerciseId, order: xi + 1, sets: it.sets, reps: it.reps.trim() || '12' })),
          })),
      }
      const r = await upsertProgramTemplateAction(payload)
      if (r && 'ok' in r && !r.ok) return void toast.error(domainErrorMessage(r.error))
      toast.success('Şablon kaydedildi.')
      onSaved()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{initial ? 'Şablonu düzenle' : 'Yeni şablon'}</DialogTitle>
          <DialogDescription>Günleri 1, 2, 3… olarak ekleyin; her güne kütüphaneden hareket + set × tekrar girin. Piramit için tekrar alanına “12-10-8-8” yazabilirsiniz.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">Şablon adı</span>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Program A" />
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">Seviye</span>
              <select
                value={level}
                onChange={(e) => setLevel(e.target.value as ProgramTemplate['level'])}
                className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm"
              >
                <option value="beginner">Başlangıç</option>
                <option value="intermediate">Orta</option>
                <option value="advanced">İleri</option>
              </select>
            </label>
          </div>

          {days.map((day, di) => (
            <div key={di} className="space-y-2 rounded-xl border border-border bg-surface/50 p-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-foreground">{day.name}</p>
                <div className="flex gap-1">
                  <Button variant="ghost" size="sm" onClick={() => addItem(di)}>
                    <PlusIcon className="size-3.5" /> Hareket
                  </Button>
                  {days.length > 1 ? (
                    <Button variant="ghost" size="sm" onClick={() => removeDay(di)}>
                      <Trash2Icon className="size-3.5 text-danger" />
                    </Button>
                  ) : null}
                </div>
              </div>
              {day.items.length === 0 ? (
                <p className="text-xs text-muted-foreground">Bu güne henüz hareket eklenmedi.</p>
              ) : (
                <ul className="space-y-1.5">
                  {day.items.map((it, xi) => (
                    <li key={xi} className="flex items-center gap-1.5">
                      <select
                        value={it.exerciseId}
                        onChange={(e) => setItem(di, xi, { exerciseId: e.target.value })}
                        className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-background px-2 text-sm"
                      >
                        {active.map((ex) => (
                          <option key={ex.id} value={ex.id}>
                            {ex.nameTr}
                            {ex.muscleGroup ? ` — ${ex.muscleGroup}` : ''}
                          </option>
                        ))}
                      </select>
                      <Input
                        type="number"
                        min={1}
                        value={it.sets}
                        onChange={(e) => setItem(di, xi, { sets: Math.max(1, Number(e.target.value) || 1) })}
                        className="w-14"
                        aria-label="set"
                      />
                      <span className="text-xs text-muted-foreground">×</span>
                      <Input
                        value={it.reps}
                        onChange={(e) => setItem(di, xi, { reps: e.target.value })}
                        className="w-24"
                        placeholder="12"
                        aria-label="tekrar"
                      />
                      <Button variant="ghost" size="sm" onClick={() => removeItem(di, xi)}>
                        <Trash2Icon className="size-3.5 text-danger" />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}

          <Button variant="secondary" size="sm" onClick={addDay}>
            <PlusIcon className="size-3.5" /> Gün ekle
          </Button>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Vazgeç
          </Button>
          <Button onClick={() => void submit()} disabled={busy}>
            {busy ? <Loader2Icon className="size-4 animate-spin" /> : null} Kaydet
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Exercise library ───────────────────────────────────────────────────────────────────────────
function ExerciseLibrary({ initial }: { initial: readonly Exercise[] }) {
  const [exercises, setExercises] = useState<readonly Exercise[]>(initial)
  const [editing, setEditing] = useState<Exercise | null>(null)
  const [viewing, setViewing] = useState<Exercise | null>(null)
  const [creating, setCreating] = useState(false)

  async function reload() {
    setExercises(await listExercisesAction())
  }

  return (
    <Section
      title="Egzersiz Kütüphanesi"
      hint={`${exercises.length} egzersiz`}
      actions={
        <Button size="sm" onClick={() => setCreating(true)}>
          <PlusIcon /> Egzersiz Ekle
        </Button>
      }
    >
      {exercises.length === 0 ? (
        <EmptyState
          icon={DumbbellIcon}
          title="Henüz egzersiz yok"
          description="Programlarda kullanacağınız egzersizleri ekleyin. Her egzersiz kas grubu, ekipman ve video bağlantısı taşıyabilir."
          action={
            <Button size="sm" onClick={() => setCreating(true)}>
              <PlusIcon /> Egzersiz Ekle
            </Button>
          }
        />
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {exercises.map((ex) => (
            <li
              key={ex.id}
              className={`flex items-start justify-between gap-3 rounded-xl border border-border bg-card p-3 shadow-xs ${
                ex.active ? '' : 'opacity-60'
              }`}
            >
              <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setViewing(ex)} aria-label={`${ex.nameTr} rehberi`}>
                <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium text-foreground">
                  {ex.nameTr}
                  {!ex.active ? <Badge className="bg-muted text-muted-foreground">Pasif</Badge> : null}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {[ex.muscleGroup, ex.equipment].filter(Boolean).join(' · ') || 'Detay yok'}
                  {ex.videoUrl ? ' · video' : ''}
                </p>
              </button>
              <Button variant="ghost" size="sm" aria-label="Düzenle" onClick={() => setEditing(ex)}>
                <PencilIcon className="size-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      {creating ? (
        <ExerciseDialog
          initial={null}
          all={exercises}
          onClose={() => setCreating(false)}
          onSaved={async () => {
            setCreating(false)
            await reload()
          }}
        />
      ) : null}
      {editing ? (
        <ExerciseDialog
          initial={editing}
          all={exercises}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null)
            await reload()
          }}
        />
      ) : null}
      {viewing ? (
        <ExerciseGuideDialog exercise={viewing} onClose={() => setViewing(null)} onEdit={() => { setEditing(viewing); setViewing(null) }} />
      ) : null}
    </Section>
  )
}


function ExerciseDialog({
  initial,
  all,
  onClose,
  onSaved,
}: {
  initial: Exercise | null
  all: readonly Exercise[]
  onClose: () => void
  onSaved: () => void
}) {
  const [nameTr, setNameTr] = useState(initial?.nameTr ?? '')
  const [muscleGroup, setMuscleGroup] = useState(initial?.muscleGroup ?? '')
  const [equipment, setEquipment] = useState(initial?.equipment ?? '')
  const [videoUrl, setVideoUrl] = useState(initial?.videoUrl ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [tips, setTips] = useState(initial?.tips ?? '')
  const [commonMistakes, setCommonMistakes] = useState(initial?.commonMistakes ?? '')
  const [alternatives, setAlternatives] = useState<string[]>(initial ? [...initial.alternativeExerciseIds] : [])
  const [active, setActive] = useState(initial?.active ?? true)
  const [busy, setBusy] = useState(false)

  const others = all.filter((e) => e.id !== initial?.id)
  const toggleAlt = (id: string) =>
    setAlternatives((a) => (a.includes(id) ? a.filter((x) => x !== id) : [...a, id]))

  async function submit() {
    if (nameTr.trim().length === 0) {
      toast.error('Egzersiz adı zorunludur.')
      return
    }
    setBusy(true)
    try {
      const res = await upsertExerciseAction({
        id: initial?.id,
        nameTr: nameTr.trim(),
        muscleGroup: muscleGroup.trim(),
        equipment: equipment.trim(),
        videoUrl: videoUrl.trim() || null,
        description: description.trim(),
        tips: tips.trim(),
        commonMistakes: commonMistakes.trim(),
        alternativeExerciseIds: alternatives,
        active,
      })
      if (res.ok) {
        toast.success(initial ? 'Egzersiz güncellendi.' : 'Egzersiz eklendi.')
        onSaved()
      } else {
        toast.error(domainErrorMessage(res.error))
      }
    } catch {
      toast.error('İşlem tamamlanamadı.')
    }
    setBusy(false)
  }

  async function toggleActive() {
    if (!initial) {
      setActive((v) => !v)
      return
    }
    setBusy(true)
    const res = await deactivateExerciseAction({ id: initial.id, active: !active })
    setBusy(false)
    if (res.ok) {
      setActive((v) => !v)
      toast.success(active ? 'Egzersiz pasife alındı.' : 'Egzersiz aktifleştirildi.')
    } else {
      toast.error(domainErrorMessage(res.error))
    }
  }

  return (
    <Dialog open onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{initial ? 'Egzersizi Düzenle' : 'Egzersiz Ekle'}</DialogTitle>
          <DialogDescription>Program yayınlanınca egzersizin o anki hali programa kopyalanır; sonraki düzenlemeler eski programı değiştirmez.</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <Field label="Ad (zorunlu)">
            <Input value={nameTr} onChange={(e) => setNameTr(e.target.value)} placeholder="ör. Goblet Squat" />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Kas grubu">
              <Input value={muscleGroup} onChange={(e) => setMuscleGroup(e.target.value)} placeholder="Bacak" />
            </Field>
            <Field label="Ekipman">
              <Input value={equipment} onChange={(e) => setEquipment(e.target.value)} placeholder="Dumbbell" />
            </Field>
          </div>
          <Field label="Video bağlantısı">
            <Input value={videoUrl} onChange={(e) => setVideoUrl(e.target.value)} placeholder="https://…" />
          </Field>
          <Field label="Açıklama">
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="İpuçları">
              <Textarea value={tips} onChange={(e) => setTips(e.target.value)} rows={2} />
            </Field>
            <Field label="Sık yapılan hatalar">
              <Textarea value={commonMistakes} onChange={(e) => setCommonMistakes(e.target.value)} rows={2} />
            </Field>
          </div>

          {others.length > 0 ? (
            <Field label="Alternatif egzersizler">
              <div className="flex flex-wrap gap-1.5">
                {others.map((e) => (
                  <button
                    key={e.id}
                    type="button"
                    onClick={() => toggleAlt(e.id)}
                    className={`min-h-8 rounded-lg border px-2.5 text-xs transition-colors ${
                      alternatives.includes(e.id)
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-border bg-card text-muted-foreground hover:bg-muted'
                    }`}
                  >
                    {e.nameTr}
                  </button>
                ))}
              </div>
            </Field>
          ) : null}

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={active} onChange={() => void toggleActive()} className="size-4" />
            Aktif (programlarda seçilebilir)
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

// ── Feedback center ────────────────────────────────────────────────────────────────────────────
function FeedbackCenter({
  initial,
  memberNames,
  exerciseNames,
}: {
  initial: readonly TrainingFeedback[]
  memberNames: Readonly<Record<string, string>>
  exerciseNames: Readonly<Record<string, string>>
}) {
  const [feedback, setFeedback] = useState<readonly TrainingFeedback[]>(initial)

  async function reload() {
    setFeedback(await listOpenFeedbackAction())
  }

  // Pain first, then newest.
  const ordered = [...feedback].sort((a, b) => {
    if (a.reason === 'pain' && b.reason !== 'pain') return -1
    if (b.reason === 'pain' && a.reason !== 'pain') return 1
    return b.createdAt - a.createdAt
  })

  if (ordered.length === 0) {
    return (
      <EmptyState
        icon={MessageCircleIcon}
        title="Açık geri bildirim yok"
        description="Üyeler bir egzersiz hakkında geri bildirim bıraktığında burada görünür."
      />
    )
  }

  return (
    <Section title="Geri Bildirim Merkezi" hint={`${ordered.length} açık`}>
      <ul className="space-y-2">
        {ordered.map((f) => (
          <FeedbackCard
            key={f.id}
            f={f}
            memberName={memberNames[f.memberId] ?? 'Üye'}
            exerciseName={exerciseNames[f.exerciseId] ?? 'Egzersiz'}
            onChanged={reload}
          />
        ))}
      </ul>
    </Section>
  )
}

function FeedbackCard({
  f,
  memberName,
  exerciseName,
  onChanged,
}: {
  f: TrainingFeedback
  memberName: string
  exerciseName: string
  onChanged: () => Promise<void>
}) {
  const [reply, setReply] = useState(f.trainerReply ?? '')
  const [busy, setBusy] = useState(false)
  const isPain = f.reason === 'pain'

  async function answer() {
    if (reply.trim().length === 0) {
      toast.error('Yanıt boş olamaz.')
      return
    }
    setBusy(true)
    const res = await answerFeedbackAction({ feedbackId: f.id, reply: reply.trim() })
    setBusy(false)
    if (res.ok) {
      toast.success('Yanıt gönderildi.')
      await onChanged()
    } else {
      toast.error(domainErrorMessage(res.error))
    }
  }

  async function resolve() {
    setBusy(true)
    const res = await resolveFeedbackAction({ feedbackId: f.id })
    setBusy(false)
    if (res.ok) {
      toast.success('Geri bildirim kapatıldı.')
      await onChanged()
    } else {
      toast.error(domainErrorMessage(res.error))
    }
  }

  return (
    <li
      className={`space-y-3 rounded-xl border p-3.5 shadow-xs ${
        isPain ? 'border-danger/40 bg-danger/5' : 'border-border bg-card'
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge className={FEEDBACK_REASON_TONE[f.reason]}>{FEEDBACK_REASON_LABEL[f.reason]}</Badge>
        <span className="text-sm font-medium text-foreground">{memberName}</span>
        <span className="text-xs text-muted-foreground">
          Gün {f.dayOrder} · v{f.programVersion} · {dt(f.createdAt)}
        </span>
        <Badge className="ml-auto bg-muted text-muted-foreground">{FEEDBACK_STATUS_LABEL[f.status]}</Badge>
      </div>

      {/* WHICH exercise the feedback is about — the whole point of the note (owner). */}
      <p className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
        <DumbbellIcon className="size-4 shrink-0 text-muted-foreground" />
        {exerciseName}
      </p>

      <p className="whitespace-pre-wrap text-sm text-foreground">{f.message}</p>

      {f.trainerReply ? (
        <div className="rounded-lg bg-primary-soft/40 p-2.5 text-sm">
          <p className="text-[0.6875rem] font-medium uppercase tracking-wide text-primary">Yanıtınız</p>
          <p className="whitespace-pre-wrap text-foreground">{f.trainerReply}</p>
        </div>
      ) : null}

      <div className="space-y-2">
        <Textarea
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          rows={2}
          placeholder={f.trainerReply ? 'Yanıtı güncelle…' : 'Üyeye yanıt yazın…'}
        />
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => void answer()} disabled={busy}>
            {busy ? <Loader2Icon className="animate-spin" /> : <SendIcon className="size-3.5" />}
            {f.trainerReply ? 'Yanıtı Güncelle' : 'Yanıtla'}
          </Button>
          <Button size="sm" variant="outline" onClick={() => void resolve()} disabled={busy}>
            Kapat
          </Button>
        </div>
      </div>
    </li>
  )
}

// ── shared ──────────────────────────────────────────────────────────────────────────────────────
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
      {children}
    </label>
  )
}
