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
import { domainErrorMessage } from '@/lib/domain-error'
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

  async function run(apply: boolean) {
    setBusy(true)
    try {
      const res = await duplicateWeekAction({ weekStartDate: weekStart, weeks, apply })
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
