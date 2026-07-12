'use client'

import { useEffect, useState } from 'react'
import { Loader2Icon } from 'lucide-react'
import { toast } from 'sonner'

import type { DuplicationPlan } from '@studio/core'

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
import { mondayIndex, shiftDate } from '@/components/calendar'
import { CLOSED_DAY_TYPES, DAY_TYPE_LABEL, isClosedType, type DayMark } from '@/lib/calendar-days'
import { domainErrorMessage } from '@/lib/domain-error'
import { listCalendarDaysAction } from '@/server/actions/calendar'
import { duplicateWeekAction } from '@/server/actions/scheduling'

const WEEK_MS = 7 * 86_400_000
const label = (dateStr: string) =>
  new Date(`${dateStr}T00:00:00Z`).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long' })

// "Bu haftayı tekrarla" — session-week duplication. The source week defaults to the week
// currently open on the calendar and can be changed; preview (create / skip-past /
// conflict) before writing; never a silent overwrite.
export function DuplicateWeekDialog({
  open,
  weekStartDate,
  onClose,
  onMutated,
}: {
  open: boolean
  weekStartDate: string // Monday (local) of the week currently viewed on the calendar
  onClose: () => void
  onMutated: () => void
}) {
  const [weekStart, setWeekStart] = useState(weekStartDate)
  const [weeks, setWeeks] = useState(4)
  const [until, setUntil] = useState('')
  const [plan, setPlan] = useState<DuplicationPlan | null>(null)
  const [busy, setBusy] = useState(false)
  // D23 — the marked days inside the TARGET range, and the ones the owner chose to skip.
  // A holiday is never skipped automatically: many studios run classes on 1 May. A day the
  // studio itself declared closed starts ticked — but it stays a choice, and it is visible.
  const [marks, setMarks] = useState<readonly DayMark[]>([])
  const [skip, setSkip] = useState<readonly string[]>([])

  // Each time the dialog opens, adopt the calendar's currently-viewed week.
  useEffect(() => {
    if (open) {
      setWeekStart(weekStartDate)
      setPlan(null)
      setWeeks(4)
      setUntil('')
    }
  }, [open, weekStartDate])

  // Any picked day snaps to the Monday of its week.
  function pickSourceWeek(d: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return
    setWeekStart(shiftDate(d, -mondayIndex(d)))
    setPlan(null)
    setUntil('')
  }
  function pickUntil(d: string) {
    setUntil(d)
    setPlan(null)
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) {
      const w = Math.floor((Date.parse(d) - Date.parse(weekStart)) / WEEK_MS)
      if (w >= 1) setWeeks(w)
    }
  }
  function pickWeeks(w: number) {
    setWeeks(w)
    setUntil('')
    setPlan(null)
  }

  const rangeStart = shiftDate(weekStart, 7)
  const rangeEnd = shiftDate(weekStart, weeks * 7 + 6)

  // Read the calendar for the target range whenever the range changes.
  useEffect(() => {
    if (!open) return
    let live = true
    void listCalendarDaysAction({ from: rangeStart, to: rangeEnd })
      .then((days) => {
        if (!live) return
        setMarks(days)
        // The default: closed days ticked, holidays not.
        const closed = days.filter((d) => CLOSED_DAY_TYPES.includes(d.type)).map((d) => d.dateFrom)
        setSkip(closed)
        setPlan(null)
      })
      .catch(() => {
        if (live) setMarks([])
      })
    return () => {
      live = false
    }
  }, [open, rangeStart, rangeEnd])

  // A multi-day mark expands to each of its days: the plan skips DAYS, not marks.
  const skipDates = marks
    .filter((m) => skip.includes(m.dateFrom))
    .flatMap((m) => {
      const out: string[] = []
      for (let d = m.dateFrom; d <= m.dateTo; d = shiftDate(d, 1)) out.push(d)
      return out
    })

  function toggleSkip(id: string) {
    setSkip((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
    setPlan(null)
  }

  async function run(apply: boolean) {
    setBusy(true)
    try {
      const res = await duplicateWeekAction({ weekStartDate: weekStart, weeks, apply, skipDates })
      if (!res.ok) {
        toast.error(domainErrorMessage(res.error))
        return
      }
      if (apply) {
        toast.success(`${res.value.created} seans oluşturuldu.`)
        onMutated()
        onClose()
      } else {
        setPlan(res.value.plan)
      }
    } catch {
      toast.error('İşlem tamamlanamadı.')
    } finally {
      setBusy(false)
    }
  }

  const sourceSunday = shiftDate(weekStart, 6)
  const targetStart = shiftDate(weekStart, 7) // first copied week's Monday
  const targetEnd = shiftDate(weekStart, weeks * 7 + 6) // last copied week's Sunday

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent className="max-h-[85vh] gap-3 overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Bu haftayı tekrarla</DialogTitle>
          <DialogDescription>Seçili haftadaki seanslar sonraki haftalara kopyalanır.</DialogDescription>
        </DialogHeader>

        {/* Source week — defaults to the viewed week, changeable */}
        <div className="space-y-1">
          <label className="text-sm font-medium text-foreground">Kaynak hafta</label>
          <div className="flex items-center gap-2">
            <Input type="date" className="w-40" value={weekStart} onChange={(e) => pickSourceWeek(e.target.value)} />
            <span className="text-sm text-muted-foreground">
              {label(weekStart)} – {label(sourceSunday)}
            </span>
          </div>
        </div>

        {/* Weeks */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">Kaç hafta kopyalansın?</label>
          <div className="flex flex-wrap items-center gap-2">
            {[4, 8, 12].map((w) => (
              <Button key={w} variant={weeks === w && !until ? 'default' : 'outline'} size="sm" onClick={() => pickWeeks(w)}>
                {w} hafta
              </Button>
            ))}
            <span className="text-sm text-muted-foreground">veya tarihe kadar:</span>
            <Input type="date" className="w-40" value={until} min={targetStart} onChange={(e) => pickUntil(e.target.value)} />
          </div>
          {/* Target range */}
          <p className="text-sm text-muted-foreground">
            Hedef aralık: <span className="font-medium text-foreground">{label(targetStart)} – {label(targetEnd)}</span> ({weeks} hafta)
          </p>
          <p className="text-xs text-muted-foreground">Geçmişe üretilmez; çakışan seansların üzerine yazılmaz.</p>
        </div>

        {/* D23 — the marked days that fall inside the target range. Shown BEFORE the preview,
            because they change what the preview says. */}
        {marks.length > 0 ? (
          <div className="space-y-2 rounded-lg border border-border p-3">
            <p className="text-sm font-medium text-foreground">Hedef aralıktaki özel günler</p>
            {marks.map((m) => (
              <label key={m.id} className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5 size-4 accent-[var(--color-primary)]"
                  checked={skip.includes(m.dateFrom)}
                  onChange={() => toggleSkip(m.dateFrom)}
                />
                <span>
                  <span className="font-medium text-foreground">
                    {label(m.dateFrom)}
                    {m.dateTo !== m.dateFrom ? ` – ${label(m.dateTo)}` : ''}
                  </span>{' '}
                  <span className={isClosedType(m.type) ? 'text-danger' : 'text-muted-foreground'}>
                    {DAY_TYPE_LABEL[m.type] ?? m.type} · {m.title}
                  </span>
                </span>
              </label>
            ))}
            <p className="text-xs text-muted-foreground">
              İşaretli günlere seans üretilmez. Resmî tatiller varsayılan olarak atlanmaz.
            </p>
          </div>
        ) : null}

        {/* Preview summary */}
        {plan ? (
          <div className="space-y-1.5 rounded-lg border border-border p-3 text-sm">
            <p className="text-success">✓ Oluşturulacak: <span className="font-semibold">{plan.toCreate.length}</span> seans</p>
            <p className={plan.conflicts.length ? 'text-warning' : 'text-muted-foreground'}>
              ⚠ Çakışma nedeniyle atlanacak: <span className="font-semibold">{plan.conflicts.length}</span> seans
            </p>
            <p className="text-muted-foreground">
              ⏱ Geçmişte kaldığı için oluşturulmayacak: <span className="font-semibold">{plan.skippedPast.length}</span> seans
            </p>
            <p className={plan.skippedCalendar.length ? 'text-info' : 'text-muted-foreground'}>
              📅 Özel gün nedeniyle atlanacak: <span className="font-semibold">{plan.skippedCalendar.length}</span> seans
            </p>
          </div>
        ) : null}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => run(false)} disabled={busy}>
            {busy && !plan ? <Loader2Icon className="animate-spin" /> : null} Önizle
          </Button>
          <Button onClick={() => run(true)} disabled={busy || !plan || plan.toCreate.length === 0}>
            {busy && plan ? <Loader2Icon className="animate-spin" /> : null}
            {plan ? `Oluştur (${plan.toCreate.length})` : 'Oluştur'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
