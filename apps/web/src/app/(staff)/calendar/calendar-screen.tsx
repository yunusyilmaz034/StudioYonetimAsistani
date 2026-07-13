'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { CalendarDaysIcon, DownloadIcon, Loader2Icon, PlusIcon, TrashIcon } from 'lucide-react'
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
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { PageHeader } from '@/components/ui/page-header'
import { Section } from '@/components/ui/section'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { CLOSED_DAY_TYPES, DAY_TYPE_CHIP, DAY_TYPE_LABEL } from '@/lib/calendar-days'
import { domainErrorMessage } from '@/lib/domain-error'
import {
  importHolidaysAction,
  markCalendarDayAction,
  removeCalendarDayAction,
  type CalendarDayView,
} from '@/server/actions/calendar'

const fmt = (d: string) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long' })

export function CalendarScreen({
  year,
  days,
  canEdit,
}: {
  year: number
  days: readonly CalendarDayView[]
  canEdit: boolean
}) {
  const router = useRouter()
  const [importing, setImporting] = useState(false)
  const [addOpen, setAddOpen] = useState(false)

  async function runImport() {
    setImporting(true)
    try {
      const res = await importHolidaysAction({ year })
      if (res.ok) {
        toast.success(
          `${res.value.imported} gün eklendi · ${res.value.updated} güncellendi · ${res.value.skipped} elle düzenlendiği için korundu.`,
          {
            description: res.value.religiousIncluded
              ? undefined
              : 'Bu yıl için dinî bayram tarihleri tabloda yok — yalnızca sabit resmî tatiller alındı. Bayramları elle ekleyebilirsiniz.',
          },
        )
        router.refresh()
      } else {
        toast.error(domainErrorMessage(res.error))
      }
    } catch {
      toast.error('İçe aktarma başarısız.')
    }
    setImporting(false)
  }

  async function remove(id: string) {
    const res = await removeCalendarDayAction({ id })
    if (res.ok) {
      toast.success('Gün kaldırıldı.')
      router.refresh()
    } else {
      toast.error(domainErrorMessage(res.error))
    }
  }

  const closed = days.filter((d) => CLOSED_DAY_TYPES.includes(d.type))
  const others = days.filter((d) => !CLOSED_DAY_TYPES.includes(d.type))

  return (
    <main className="mx-auto max-w-4xl space-y-5 p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="Stüdyo Takvimi"
        description={`${year} · ${days.length} gün işaretli`}
        actions={
          canEdit ? (
            <>
              <Button variant="outline" onClick={runImport} disabled={importing}>
                {importing ? <Loader2Icon className="animate-spin" /> : <DownloadIcon />}
                <span className="hidden sm:inline">Resmî Tatilleri İçe Aktar</span>
              </Button>
              <Button className="min-h-11 sm:min-h-0" onClick={() => setAddOpen(true)}>
                <PlusIcon />
                Gün Ekle
              </Button>
            </>
          ) : null
        }
      />

      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => router.push(`/calendar?year=${year - 1}`)}>
          ← {year - 1}
        </Button>
        <span className="text-h2 font-semibold tabular-nums text-foreground">{year}</span>
        <Button variant="ghost" size="sm" onClick={() => router.push(`/calendar?year=${year + 1}`)}>
          {year + 1} →
        </Button>
      </div>

      {/* The calendar WRITES INFORMATION. The only bridge to a destructive act is this button,
          and it opens a preview the owner still has to approve (D23.5). */}
      <Section title="Kapanış günleri" hint="stüdyo kapalı · bakım">
        {closed.length === 0 ? (
          <p className="text-sm text-muted-foreground">Kapanış günü yok.</p>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card shadow-sm">
            {closed.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-3">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-foreground">
                    <span>{d.title}</span>
                    <Badge className={DAY_TYPE_CHIP[d.type] ?? ''}>{DAY_TYPE_LABEL[d.type]}</Badge>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {fmt(d.dateFrom)}
                    {d.dateTo !== d.dateFrom ? ` – ${fmt(d.dateTo)}` : ''}
                    {d.timeFrom ? ` · ${d.timeFrom}–${d.timeTo}` : ''}
                  </p>
                </div>
                {canEdit ? (
                  <div className="flex shrink-0 items-center gap-2">
                    <Button
                      size="sm"
                      render={
                        <Link
                          href={`/operations/closures/new?from=${d.dateFrom}&to=${d.dateTo}&reason=${encodeURIComponent(d.title)}&day=${d.id}`}
                        />
                      }
                    >
                      Etki Analizi Oluştur
                    </Button>
                    <Button variant="ghost" size="icon-sm" aria-label="Kaldır" onClick={() => remove(d.id)}>
                      <TrashIcon />
                    </Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-muted-foreground">
          Bir günü kapalı işaretlemek hiçbir dersi iptal etmez ve hiçbir krediyi iade etmez. Bunlar
          yalnızca <span className="font-medium text-foreground">Etki Analizi</span> ile, sizin
          onayınızla yapılır.
        </p>
      </Section>

      <Section title="Tatiller ve özel günler">
        {others.length === 0 ? (
          <EmptyState
            icon={CalendarDaysIcon}
            title="Bu yıl için gün yok"
            description="Resmî tatilleri içe aktarın veya elle bir gün ekleyin."
          />
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card shadow-sm">
            {others.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-foreground">
                    <span className="truncate">{d.title}</span>
                    <Badge className={DAY_TYPE_CHIP[d.type] ?? ''}>{DAY_TYPE_LABEL[d.type]}</Badge>
                    {d.source === 'provider' ? (
                      <span className="text-[0.6875rem] text-muted-foreground">içe aktarıldı</span>
                    ) : null}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {fmt(d.dateFrom)}
                    {d.dateTo !== d.dateFrom ? ` – ${fmt(d.dateTo)}` : ''}
                  </p>
                </div>
                {canEdit ? (
                  <Button variant="ghost" size="icon-sm" aria-label="Kaldır" onClick={() => remove(d.id)}>
                    <TrashIcon />
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <AddDayDialog open={addOpen} onClose={() => setAddOpen(false)} onDone={() => router.refresh()} />
    </main>
  )
}

function AddDayDialog({
  open,
  onClose,
  onDone,
}: {
  open: boolean
  onClose: () => void
  onDone: () => void
}) {
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [type, setType] = useState('studio_closed')
  const [title, setTitle] = useState('')
  const [timeFrom, setTimeFrom] = useState('')
  const [timeTo, setTimeTo] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  async function save() {
    setBusy(true)
    try {
      const res = await markCalendarDayAction({
        dateFrom,
        dateTo: dateTo || dateFrom,
        type,
        title,
        timeFrom: timeFrom || null,
        timeTo: timeTo || null,
        note: note || null,
      })
      if (res.ok) {
        toast.success('Gün takvime eklendi.')
        onDone()
        onClose()
      } else {
        toast.error(domainErrorMessage(res.error))
      }
    } catch {
      toast.error('Kaydedilemedi.')
    }
    setBusy(false)
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent className="max-h-[85vh] gap-3 overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Takvime gün ekle</DialogTitle>
          <DialogDescription>
            Bu yalnızca takvime bilgi yazar. Hiçbir ders iptal edilmez, hiçbir kredi iade edilmez.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Başlangıç">
            <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </Field>
          <Field label="Bitiş (opsiyonel)">
            <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </Field>
        </div>

        <Field label="Tür">
          <Select value={type} onValueChange={(v) => setType(v ?? 'studio_closed')}>
            <SelectTrigger className="w-full">
              <SelectValue>{(v: unknown) => DAY_TYPE_LABEL[String(v)] ?? 'Seçin'}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {Object.entries(DAY_TYPE_LABEL).map(([k, label]) => (
                <SelectItem key={k} value={k}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field label="Başlık">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Yıllık bakım" />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Saat başlangıç (opsiyonel)">
            <Input type="time" value={timeFrom} onChange={(e) => setTimeFrom(e.target.value)} />
          </Field>
          <Field label="Saat bitiş (opsiyonel)">
            <Input type="time" value={timeTo} onChange={(e) => setTimeTo(e.target.value)} />
          </Field>
        </div>

        <Field label="Not (opsiyonel)">
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button onClick={save} disabled={busy || !dateFrom || title.trim().length === 0}>
            {busy ? <Loader2Icon className="animate-spin" /> : null} Ekle
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-[0.6875rem] font-medium tracking-wide uppercase text-muted-foreground">
        {label}
      </label>
      {children}
    </div>
  )
}
