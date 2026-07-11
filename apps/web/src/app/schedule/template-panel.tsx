'use client'

import { useMemo, useState } from 'react'
import { Loader2Icon, PlusIcon } from 'lucide-react'
import { toast } from 'sonner'

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
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import { domainErrorMessage } from '@/lib/domain-error'
import {
  createTemplateAction,
  generateSessionsAction,
  updateTemplateAction,
} from '@/server/actions/scheduling'
import type { ScheduleData, TemplateView } from '@/server/schedule-query'

// dayOfWeek follows JS getUTCDay: 0 = Sunday (occurrenceDates, time-window.ts).
const DOW = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi']
const NONE = '__none__'

interface FormState {
  serviceId: string
  dayOfWeek: number
  startTime: string
  durationMinutes: number
  capacity: number
  roomId: string
  trainerId: string
  validFrom: string
  validUntil: string
  reason: string
}

export function TemplatePanel({
  open,
  data,
  defaultBranchId,
  onClose,
  onMutated,
}: {
  open: boolean
  data: ScheduleData
  defaultBranchId: string | null
  onClose: () => void
  onMutated: () => void
}) {
  const [editing, setEditing] = useState<TemplateView | 'new' | null>(null)
  const [generating, setGenerating] = useState<TemplateView | null>(null)
  const [weeks, setWeeks] = useState(4)
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState<FormState | null>(null)

  const branchId = defaultBranchId ?? data.rooms[0]?.branchId ?? ''
  const branchName = useMemo(
    () => data.sessions.find((s) => s.branchId === branchId)?.branchName ?? branchId,
    [data.sessions, branchId],
  )

  function startEdit(t: TemplateView | 'new') {
    if (t === 'new') {
      setForm({
        serviceId: data.services[0]?.id ?? '',
        dayOfWeek: 1,
        startTime: '10:00',
        durationMinutes: 60,
        capacity: 8,
        roomId: NONE,
        trainerId: NONE,
        validFrom: '',
        validUntil: '',
        reason: '',
      })
    } else {
      setForm({
        serviceId: t.serviceId,
        dayOfWeek: t.dayOfWeek,
        startTime: t.startTime,
        durationMinutes: t.durationMinutes,
        capacity: t.capacity,
        roomId: t.roomId ?? NONE,
        trainerId: t.trainerId ?? NONE,
        validFrom: t.validFrom,
        validUntil: t.validUntil,
        reason: '',
      })
    }
    setEditing(t)
  }

  async function submitForm() {
    if (!form || !editing) return
    const isNew = editing === 'new'
    if (isNew && !form.serviceId) {
      toast.error('Bir ders seçin.')
      return
    }
    if (!isNew && form.reason.trim().length === 0) {
      toast.error('Bir sebep girin.')
      return
    }
    setBusy(true)
    try {
      const common = {
        roomId: form.roomId === NONE ? null : form.roomId,
        trainerId: form.trainerId === NONE ? null : form.trainerId,
        dayOfWeek: form.dayOfWeek,
        startTime: form.startTime,
        durationMinutes: form.durationMinutes,
        capacity: form.capacity,
        validFrom: form.validFrom,
        validUntil: form.validUntil,
      }
      const res = isNew
        ? await createTemplateAction({ ...common, serviceId: form.serviceId, branchId })
        : await updateTemplateAction({ ...common, templateId: (editing as TemplateView).id, reason: form.reason.trim() })
      if (res.ok) {
        toast.success(isNew ? 'Şablon oluşturuldu.' : 'Şablon güncellendi.')
        setEditing(null)
        onMutated()
      } else {
        toast.error(domainErrorMessage(res.error))
      }
    } catch {
      toast.error('İşlem tamamlanamadı.')
    }
    setBusy(false)
  }

  async function submitGenerate() {
    if (!generating) return
    setBusy(true)
    try {
      const res = await generateSessionsAction({ templateId: generating.id, weeks, branchName })
      if (res.ok) {
        toast.success(`${res.value.created} seans üretildi.`)
        setGenerating(null)
        onMutated()
      } else {
        toast.error(domainErrorMessage(res.error))
      }
    } catch {
      toast.error('Üretim tamamlanamadı.')
    }
    setBusy(false)
  }

  return (
    <>
      <Sheet open={open} onOpenChange={(o) => (o ? null : onClose())}>
        <SheetContent side="right" className="w-full gap-4 overflow-y-auto p-4 sm:max-w-md">
          <SheetHeader className="p-0">
            <SheetTitle>Haftalık Şablonlar</SheetTitle>
            <SheetDescription>Şablon düzenlemeleri yalnızca gelecekte üretilecek seansları etkiler.</SheetDescription>
          </SheetHeader>

          <Button className="min-h-11 w-full" onClick={() => startEdit('new')} disabled={data.services.length === 0}>
            <PlusIcon />
            Yeni Şablon
          </Button>

          {data.templates.length === 0 ? (
            <p className="text-sm text-muted-foreground">Henüz şablon yok.</p>
          ) : (
            <ul className="space-y-2">
              {data.templates.map((t) => (
                <li key={t.id} className="rounded-xl border border-border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-medium text-foreground">
                      {DOW[t.dayOfWeek]} · <span className="tabular-nums">{t.startTime}</span>
                    </p>
                    {t.active ? null : <Badge variant="outline">Pasif</Badge>}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t.serviceName} · {t.capacity} kişi · {t.durationMinutes} dk
                  </p>
                  <div className="mt-2 flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => startEdit(t)}>
                      Düzenle
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setGenerating(t)} disabled={!t.active}>
                      Seans Üret
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </SheetContent>
      </Sheet>

      {/* Create / edit form */}
      <Dialog open={editing !== null} onOpenChange={(o) => (o ? null : setEditing(null))}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing === 'new' ? 'Yeni Şablon' : 'Şablonu Düzenle'}</DialogTitle>
            <DialogDescription>Yalnızca gelecekte üretilecek seansları etkiler.</DialogDescription>
          </DialogHeader>

          {form ? (
            <div className="space-y-3">
              {editing === 'new' ? (
                <Labeled label="Ders">
                  <Select value={form.serviceId} onValueChange={(v) => setForm({ ...form, serviceId: v ?? '' })}>
                    <SelectTrigger>
                      <SelectValue placeholder="Ders seç" />
                    </SelectTrigger>
                    <SelectContent>
                      {data.services.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Labeled>
              ) : null}

              <div className="grid grid-cols-2 gap-3">
                <Labeled label="Gün">
                  <Select value={String(form.dayOfWeek)} onValueChange={(v) => setForm({ ...form, dayOfWeek: Number(v) })}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DOW.map((d, i) => (
                        <SelectItem key={d} value={String(i)}>
                          {d}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Labeled>
                <Labeled label="Saat">
                  <Input type="time" value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} />
                </Labeled>
                <Labeled label="Süre (dk)">
                  <Input type="number" min={1} value={form.durationMinutes} onChange={(e) => setForm({ ...form, durationMinutes: Math.max(1, Number(e.target.value) || 1) })} />
                </Labeled>
                <Labeled label="Kapasite">
                  <Input type="number" min={1} value={form.capacity} onChange={(e) => setForm({ ...form, capacity: Math.max(1, Number(e.target.value) || 1) })} />
                </Labeled>
                <Labeled label="Başlangıç">
                  <Input type="date" value={form.validFrom} onChange={(e) => setForm({ ...form, validFrom: e.target.value })} />
                </Labeled>
                <Labeled label="Bitiş">
                  <Input type="date" value={form.validUntil} onChange={(e) => setForm({ ...form, validUntil: e.target.value })} />
                </Labeled>
              </div>

              <Labeled label="Salon (opsiyonel)">
                <Select value={form.roomId} onValueChange={(v) => setForm({ ...form, roomId: v ?? NONE })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Salon yok</SelectItem>
                    {data.rooms.map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        {r.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Labeled>
              <Labeled label="Eğitmen (opsiyonel)">
                <Select value={form.trainerId} onValueChange={(v) => setForm({ ...form, trainerId: v ?? NONE })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Eğitmen yok</SelectItem>
                    {data.staff.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Labeled>

              {editing !== 'new' ? (
                <Textarea placeholder="Sebep (zorunlu)" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
              ) : null}
            </div>
          ) : null}

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)} disabled={busy}>
              Vazgeç
            </Button>
            <Button onClick={submitForm} disabled={busy}>
              {busy ? <Loader2Icon className="animate-spin" /> : null}
              Kaydet
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Generate */}
      <Dialog open={generating !== null} onOpenChange={(o) => (o ? null : setGenerating(null))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Seans Üret</DialogTitle>
            <DialogDescription>
              {generating ? `${DOW[generating.dayOfWeek]} ${generating.startTime}` : ''} · kaç hafta ileri üretilsin?
            </DialogDescription>
          </DialogHeader>
          <Input type="number" min={1} max={52} value={weeks} onChange={(e) => setWeeks(Math.min(52, Math.max(1, Number(e.target.value) || 1)))} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setGenerating(null)} disabled={busy}>
              Vazgeç
            </Button>
            <Button onClick={submitGenerate} disabled={busy}>
              {busy ? <Loader2Icon className="animate-spin" /> : null}
              Üret
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <span className="text-sm font-medium text-foreground">{label}</span>
      {children}
    </div>
  )
}
