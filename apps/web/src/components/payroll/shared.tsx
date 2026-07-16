'use client'

import { useEffect, useState } from 'react'
import type { EarningLine, PayrollStatementDraft } from '@studio/core'

import { Input } from '@/components/ui/input'
import { Metric, MetricStrip } from '@/components/ui/metric'
import { formatKurus, LINE_LABEL } from '@/lib/payroll-labels'

// Shared payroll UI — the period picker and the earnings breakdown, used by both the owner Bordro
// screen and the trainer's read-only Hakedişim screen. Client-only; money stays kuruş until display.

// Five client components already hard-code the studio offset (settings note); payroll follows suit —
// a picker that half-worked with a real timezone picker would be worse than an honest fixed offset.
const OFFSET_MIN = 180
const DAY = 86_400_000

function localToday(): { y: number; m: number; d: number; wd: number } {
  const t = new Date(Date.now() + OFFSET_MIN * 60_000)
  return { y: t.getUTCFullYear(), m: t.getUTCMonth(), d: t.getUTCDate(), wd: t.getUTCDay() }
}
// Local (Istanbul) midnight of y-m-d as an epoch-ms. Date.UTC normalises month/day overflow.
function localMidnight(y: number, m: number, d: number): number {
  return Date.UTC(y, m, d, 0, 0, 0) - OFFSET_MIN * 60_000
}
function toParts(value: string): { y: number; m: number; d: number } | null {
  const [y, m, d] = value.split('-').map(Number)
  if (!y || !m || !d) return null
  return { y, m: m - 1, d }
}
function isoDate(ms: number): string {
  const t = new Date(ms + OFFSET_MIN * 60_000)
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`
}

export type PeriodMode = 'month' | 'week' | 'custom'
export interface Period {
  readonly start: number
  readonly end: number // exclusive
  readonly label: string
}

export function monthPeriod(): Period {
  const { y, m } = localToday()
  return { start: localMidnight(y, m, 1), end: localMidnight(y, m + 1, 1), label: 'Bu ay' }
}
function weekPeriod(): Period {
  const { y, m, d, wd } = localToday()
  const fromMonday = (wd + 6) % 7 // Mon=0 … Sun=6
  const start = localMidnight(y, m, d - fromMonday)
  return { start, end: start + 7 * DAY, label: 'Bu hafta' }
}

// The period picker. Emits [start, end) whenever the selection changes.
export function PeriodPicker({ onChange }: { onChange: (p: Period) => void }) {
  const [mode, setMode] = useState<PeriodMode>('month')
  const [from, setFrom] = useState(() => isoDate(monthPeriod().start))
  const [to, setTo] = useState(() => isoDate(monthPeriod().end - DAY))

  useEffect(() => {
    if (mode === 'month') onChange(monthPeriod())
    else if (mode === 'week') onChange(weekPeriod())
    else {
      const a = toParts(from)
      const b = toParts(to)
      if (a && b) {
        const start = localMidnight(a.y, a.m, a.d)
        const end = localMidnight(b.y, b.m, b.d) + DAY // inclusive last day
        if (end > start) onChange({ start, end, label: 'Özel dönem' })
      }
    }
  }, [mode, from, to, onChange])

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="inline-flex overflow-hidden rounded-lg border border-border">
        {(['month', 'week', 'custom'] as const).map((mo) => (
          <button
            key={mo}
            type="button"
            onClick={() => setMode(mo)}
            className={`min-h-9 px-3 text-sm transition-colors ${mode === mo ? 'bg-primary text-primary-foreground' : 'bg-card hover:bg-muted/50'}`}
          >
            {mo === 'month' ? 'Bu ay' : mo === 'week' ? 'Bu hafta' : 'Özel'}
          </button>
        ))}
      </div>
      {mode === 'custom' ? (
        <div className="flex items-center gap-1.5">
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-auto" />
          <span className="text-muted-foreground">–</span>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-auto" />
        </div>
      ) : null}
    </div>
  )
}

// The earnings breakdown — the line items that make up a statement, then the totals. `netPayable` is
// the number the owner acts on; a negative net (an advance exceeding earnings) reads in the danger tone.
export function EarningsBreakdown({ draft }: { draft: PayrollStatementDraft }) {
  const net = draft.netPayable.amount
  return (
    <div className="space-y-3">
      {draft.lines.length > 0 ? (
        <ul className="divide-y divide-border rounded-xl border border-border bg-card">
          {draft.lines.map((l: EarningLine) => (
            <li key={l.kind} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
              <span className="text-foreground">
                {LINE_LABEL[l.kind]}
                <span className="ml-2 text-xs text-muted-foreground">{quantityLabel(l)}</span>
              </span>
              <span className="font-medium tabular-nums text-foreground">{formatKurus(l.amount.amount)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-xl border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
          Bu dönemde hesaplanan hakediş yok (gerçekleşmiş ders veya satış bulunmuyor).
        </p>
      )}

      <MetricStrip>
        <Metric label="Gerçekleşen ders" value={draft.classCount} compact />
        <Metric label="Katılan üye" value={draft.attendeeCount} compact />
        <Metric label="Satış" value={formatKurus(draft.salesTotal.amount)} compact />
        <Metric
          label="Düzeltme"
          value={formatKurus(draft.adjustmentsTotal.amount)}
          tone={draft.adjustmentsTotal.amount < 0 ? 'warning' : 'default'}
          compact
        />
      </MetricStrip>

      <div className="flex items-center justify-between rounded-xl border border-border bg-muted/40 px-4 py-3">
        <span className="text-sm font-medium text-muted-foreground">Net hakediş</span>
        <span className={`font-heading text-h2 font-medium tabular-nums ${net < 0 ? 'text-danger' : 'text-foreground'}`}>
          {formatKurus(net)}
        </span>
      </div>
    </div>
  )
}

function quantityLabel(l: EarningLine): string {
  switch (l.kind) {
    case 'hourly':
      return `${l.quantity.toLocaleString('tr-TR', { maximumFractionDigits: 1 })} saat`
    case 'per_class':
      return `${l.quantity} ders`
    case 'per_member':
      return `${l.quantity} üye`
    case 'commission':
      return `${l.quantity} satış`
    case 'base':
      return `${l.quantity} gün`
  }
}

// A tiny status pill so both screens read a statement's state the same way.
export function StatusPill({ status }: { status: 'draft' | 'finalized' | 'paid' }) {
  const map = {
    draft: 'bg-muted text-muted-foreground',
    finalized: 'bg-primary/10 text-primary',
    paid: 'bg-success/10 text-success',
  } as const
  const label = { draft: 'Taslak', finalized: 'Kesinleşti', paid: 'Ödendi' }[status]
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${map[status]}`}>{label}</span>
}
