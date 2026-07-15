'use client'

import { useMemo, useState } from 'react'

import type { Measurement } from '@studio/core'

import { AreaChart } from '@/components/ui/chart'

// MEASUREMENT CHART (Plus Phase 7). A member's body metrics over time, one series at a time — reusing
// the house `AreaChart` (hand-authored, token-driven, no chart library). Shown on both the staff
// member panel and the member portal's "Gelişimim".
//
// Only metrics that actually have readings get a chip; a metric with fewer than two points can't be a
// line, so it shows its single value instead of a broken chart.

type MetricKey = 'weightKg' | 'fatPercent' | 'musclePercent' | 'waterPercent' | 'bmi'

const METRICS: readonly { key: MetricKey; label: string; unit: string }[] = [
  { key: 'weightKg', label: 'Kilo', unit: 'kg' },
  { key: 'fatPercent', label: 'Yağ', unit: '%' },
  { key: 'musclePercent', label: 'Kas', unit: '%' },
  { key: 'waterPercent', label: 'Su', unit: '%' },
  { key: 'bmi', label: 'BMI', unit: '' },
]

const TZ = 'Europe/Istanbul'
const shortDate = (localDate: string) => {
  const ms = Date.parse(`${localDate}T00:00:00+03:00`)
  return Number.isNaN(ms) ? localDate : new Date(ms).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', timeZone: TZ })
}

export function MeasurementChart({ measurements }: { measurements: readonly Measurement[] }) {
  // Chronological, and only the readings that ARE a reading (a correction supersedes, but every row is
  // still a point in the history — we chart what the member currently has, newest correction included).
  const ordered = useMemo(
    () => [...measurements].sort((a, b) => a.takenOn.localeCompare(b.takenOn)),
    [measurements],
  )

  const available = useMemo(
    () => METRICS.filter((m) => ordered.some((row) => row[m.key] != null)),
    [ordered],
  )

  const [active, setActive] = useState<MetricKey | null>(available[0]?.key ?? null)
  const metric = available.find((m) => m.key === active) ?? available[0]

  if (!metric) {
    return <p className="text-sm text-muted-foreground">Grafiği çizecek ölçüm yok.</p>
  }

  const points = ordered
    .map((row) => ({ takenOn: row.takenOn, value: row[metric.key] }))
    .filter((p): p is { takenOn: string; value: number } => p.value != null)

  const data = points.map((p) => p.value)
  const labels = points.map((p) => shortDate(p.takenOn))
  const last = points[points.length - 1]
  const first = points[0]
  const delta = last && first ? last.value - first.value : 0

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {available.map((m) => (
          <button
            key={m.key}
            type="button"
            onClick={() => setActive(m.key)}
            className={`min-h-8 rounded-lg border px-2.5 text-xs font-medium transition-colors ${
              m.key === metric.key
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border bg-card text-muted-foreground hover:bg-muted'
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-heading text-h1 font-medium tabular-nums text-foreground">
          {last?.value}
          <span className="ml-1 text-sm font-normal text-muted-foreground">{metric.unit}</span>
        </span>
        {points.length > 1 ? (
          <span className={`text-xs tabular-nums ${delta > 0 ? 'text-warning' : delta < 0 ? 'text-success' : 'text-muted-foreground'}`}>
            {delta > 0 ? '+' : ''}
            {delta.toFixed(1)} {metric.unit} · ilk ölçümden
          </span>
        ) : null}
      </div>

      {data.length >= 2 ? (
        <AreaChart data={data} labels={labels} height={160} />
      ) : (
        <p className="text-sm text-muted-foreground">Bu metrik için tek ölçüm var — grafik için en az iki gerekli.</p>
      )}
    </div>
  )
}
