'use client'

import { useEffect, useState } from 'react'
import { Loader2Icon, RepeatIcon } from 'lucide-react'
import { toast } from 'sonner'

import type { RecurringPlan, RecurringSkipReason } from '@studio/core'

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
import { CLOSED_DAY_TYPES, DAY_TYPE_LABEL, type DayMark } from '@/lib/calendar-days'
import { domainErrorMessage } from '@/lib/domain-error'
import { listCalendarDaysAction } from '@/server/actions/calendar'
import { applyRecurringAction, previewRecurringAction } from '@/server/actions/reservations'

// D18 — "Sabit rezervasyon": repeat this class, same slot, for the next N weeks. It books
// ORDINARY reservations — each one cancellable on its own — and it never creates a class that
// the studio did not schedule. Every week that produces no booking is named, not dropped.

const SKIP_LABEL: Record<RecurringSkipReason, string> = {
  no_session: 'O hafta bu saatte seans yok',
  session_cancelled: 'Seans iptal edilmiş',
  session_full: 'Seans dolu',
  session_in_past: 'Seans geçmişte',
  already_booked: 'Zaten kayıtlı',
  no_eligible_entitlement: 'Uygun paket / kredi yok',
  calendar_day: 'Özel gün (atlandı)',
}

const fmtDate = (d: string) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', weekday: 'short' })

export function RecurringDialog({
  open,
  memberId,
  memberName,
  sessionId,
  seedStartsAt,
  onClose,
  onBooked,
}: {
  open: boolean
  memberId: string | null
  memberName: string
  sessionId: string
  seedStartsAt: number
  onClose: () => void
  onBooked: () => void
}) {
  const [weeks, setWeeks] = useState(4)
  const [plan, setPlan] = useState<RecurringPlan | null>(null)
  const [marks, setMarks] = useState<readonly DayMark[]>([])
  const [skip, setSkip] = useState<readonly string[]>([])
  const [busy, setBusy] = useState(false)

  const rangeFrom = new Date(seedStartsAt + 180 * 60_000 + 86_400_000).toISOString().slice(0, 10)
  const rangeTo = new Date(seedStartsAt + 180 * 60_000 + (weeks + 1) * 7 * 86_400_000)
    .toISOString()
    .slice(0, 10)

  useEffect(() => {
    if (!open) return
    setPlan(null)
    void listCalendarDaysAction({ from: rangeFrom, to: rangeTo })
      .then((days) => {
        setMarks(days)
        setSkip(days.filter((d) => CLOSED_DAY_TYPES.includes(d.type)).map((d) => d.dateFrom))
      })
      .catch(() => setMarks([]))
  }, [open, rangeFrom, rangeTo])

  async function preview() {
    if (!memberId) return
    setBusy(true)
    try {
      const p = await previewRecurringAction({ memberId, sessionId, weeks, skipDates: [...skip] })
      if (p) setPlan(p)
      else toast.error('Seans okunamadı.')
    } catch {
      toast.error('Önizleme alınamadı.')
    }
    setBusy(false)
  }

  async function apply() {
    if (!memberId || !plan) return
    setBusy(true)
    try {
      const res = await applyRecurringAction({ memberId, sessionId, weeks, skipDates: [...skip] })
      if (res.ok) {
        toast.success(
          `${res.value.booked} rezervasyon oluşturuldu${res.value.failed > 0 ? `, ${res.value.failed} tanesi yapılamadı` : ''}.`,
        )
        onBooked()
        onClose()
      } else {
        toast.error(domainErrorMessage(res.error))
      }
    } catch {
      toast.error('Sabit rezervasyon oluşturulamadı.')
    }
    setBusy(false)
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent className="max-h-[85vh] gap-3 overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Sabit rezervasyon</DialogTitle>
          <DialogDescription>
            {memberName} önümüzdeki haftalarda aynı gün ve saatteki seanslara kaydedilir. Yalnızca
            var olan seanslara — yeni seans oluşturulmaz.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">Kaç hafta?</label>
          <div className="flex flex-wrap items-center gap-2">
            {[4, 8, 12].map((w) => (
              <Button
                key={w}
                variant={weeks === w ? 'default' : 'outline'}
                size="sm"
                onClick={() => {
                  setWeeks(w)
                  setPlan(null)
                }}
              >
                {w} hafta
              </Button>
            ))}
            <Input
              type="number"
              min={1}
              max={26}
              className="w-24"
              value={weeks}
              onChange={(e) => {
                setWeeks(Math.min(26, Math.max(1, Number(e.target.value) || 1)))
                setPlan(null)
              }}
            />
          </div>
        </div>

        {marks.length > 0 ? (
          <div className="space-y-2 rounded-lg border border-border p-3">
            <p className="text-sm font-medium text-foreground">Aralıktaki özel günler</p>
            {marks.map((m) => (
              <label key={m.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="size-4 accent-[var(--color-primary)]"
                  checked={skip.includes(m.dateFrom)}
                  onChange={() => {
                    setSkip((prev) =>
                      prev.includes(m.dateFrom) ? prev.filter((x) => x !== m.dateFrom) : [...prev, m.dateFrom],
                    )
                    setPlan(null)
                  }}
                />
                <span>
                  <span className="font-medium text-foreground">{fmtDate(m.dateFrom)}</span>{' '}
                  <span className="text-muted-foreground">
                    {DAY_TYPE_LABEL[m.type] ?? m.type} · {m.title}
                  </span>
                </span>
              </label>
            ))}
          </div>
        ) : null}

        {plan ? (
          <div className="space-y-2 rounded-lg border border-border p-3 text-sm">
            <p className="text-success">
              ✓ Oluşturulacak: <span className="font-semibold">{plan.toBook.length}</span> rezervasyon
            </p>
            <ul className="space-y-0.5 text-xs text-muted-foreground">
              {plan.toBook.map((t) => (
                <li key={t.sessionId} className="tabular-nums">
                  {fmtDate(t.date)} · {t.entitlementName}
                </li>
              ))}
            </ul>
            {plan.skipped.length > 0 ? (
              <div className="space-y-0.5 border-t border-border pt-2">
                <p className="font-medium text-warning">Atlanacak: {plan.skipped.length} hafta</p>
                {plan.skipped.map((s) => (
                  <p key={`${s.weekOffset}`} className="text-xs text-muted-foreground">
                    {fmtDate(s.date)} — {SKIP_LABEL[s.reason]}
                  </p>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={preview} disabled={busy}>
            {busy && !plan ? <Loader2Icon className="animate-spin" /> : null} Önizle
          </Button>
          <Button onClick={apply} disabled={busy || !plan || plan.toBook.length === 0}>
            {busy && plan ? <Loader2Icon className="animate-spin" /> : <RepeatIcon />}
            {plan ? `Oluştur (${plan.toBook.length})` : 'Oluştur'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
