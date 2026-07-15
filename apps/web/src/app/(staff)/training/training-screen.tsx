'use client'

import { useState } from 'react'
import { DumbbellIcon, Loader2Icon, MessageCircleIcon, PencilIcon, PlusIcon, SendIcon } from 'lucide-react'
import { toast } from 'sonner'

import type { Exercise, TrainingFeedback } from '@studio/core'

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
import { domainErrorMessage } from '@/lib/domain-error'
import { FEEDBACK_REASON_LABEL, FEEDBACK_REASON_TONE, FEEDBACK_STATUS_LABEL } from '@/lib/training-labels'
import {
  answerFeedbackAction,
  deactivateExerciseAction,
  listExercisesAction,
  listOpenFeedbackAction,
  resolveFeedbackAction,
  upsertExerciseAction,
} from '@/server/actions/training'

const TZ = 'Europe/Istanbul'
const dt = (ms: number) => new Date(ms).toLocaleString('tr-TR', { timeZone: TZ, dateStyle: 'medium', timeStyle: 'short' })

export function TrainingScreen({
  initialExercises,
  initialFeedback,
  memberNames,
}: {
  initialExercises: readonly Exercise[]
  initialFeedback: readonly TrainingFeedback[]
  memberNames: Readonly<Record<string, string>>
}) {
  const openCount = initialFeedback.filter((f) => f.status !== 'resolved').length
  return (
    <main className="mx-auto max-w-5xl space-y-5 p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="Antrenman"
        description="Egzersiz kütüphanesi ve üye geri bildirimleri. Üye programları, ölçümleri ve fotoğrafları üye kartından yönetilir."
      />
      <Tabs defaultValue="library">
        <TabsList className="flex w-full">
          <TabsTrigger value="library" className="min-h-9 flex-1">
            <DumbbellIcon className="size-4" />
            <span className="hidden sm:inline">Egzersiz Kütüphanesi</span>
            <span className="sm:hidden">Kütüphane</span>
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
        <TabsContent value="feedback">
          <FeedbackCenter initial={initialFeedback} memberNames={memberNames} />
        </TabsContent>
      </Tabs>
    </main>
  )
}

// ── Exercise library ───────────────────────────────────────────────────────────────────────────
function ExerciseLibrary({ initial }: { initial: readonly Exercise[] }) {
  const [exercises, setExercises] = useState<readonly Exercise[]>(initial)
  const [editing, setEditing] = useState<Exercise | null>(null)
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
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium text-foreground">
                  {ex.nameTr}
                  {!ex.active ? <Badge className="bg-muted text-muted-foreground">Pasif</Badge> : null}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {[ex.muscleGroup, ex.equipment].filter(Boolean).join(' · ') || 'Detay yok'}
                  {ex.videoUrl ? ' · video' : ''}
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setEditing(ex)}>
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
}: {
  initial: readonly TrainingFeedback[]
  memberNames: Readonly<Record<string, string>>
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
          <FeedbackCard key={f.id} f={f} memberName={memberNames[f.memberId] ?? 'Üye'} onChanged={reload} />
        ))}
      </ul>
    </Section>
  )
}

function FeedbackCard({
  f,
  memberName,
  onChanged,
}: {
  f: TrainingFeedback
  memberName: string
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
