'use client'

import { useEffect, useState, useTransition } from 'react'
import { Loader2Icon } from 'lucide-react'

import { Section } from '@/components/ui/section'
import { tl, type ExportableTable } from '@/lib/widgets/contract'
import { loadAnalyticsAction, type AnalyticsSeries } from '@/server/actions/analytics'

// THE TREND REPORT (PF-40, 2026-07-27) — what used to be the `/analytics` screen.
//
// It was never a different KIND of thing from the other reports: the same date range over the same
// events, drawn instead of listed. Keeping it separate meant two date pickers and two export buttons
// for one question, and a menu in which "Raporlar" and "Analiz" could not be told apart by name.
//
// So the screen became a REPORT, and this is its body. It owns no range picker, no export button and
// no page header — the reports screen owns all three, exactly as it does for the other seven. What
// this component does is fetch its series for the range it is handed and draw it, and hand its table
// upward so the one CSV button on the page can export it.
//
// The charts stay hand-drawn SVG: a charting library is 60–200 kB for six bar charts, and this must
// stay cheap enough that the owner opens it on a phone between classes.

const dayLabel = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}`

export function TrendReport({
  fromMs,
  toMs,
  onTable,
}: {
  fromMs: number
  toMs: number
  // Lifted so the page's single export button can reach this report's rows. The contract is the same
  // `ExportableTable` every other report produces — the exporter never learns there are charts.
  onTable: (t: ExportableTable | null) => void
}) {
  const [data, setData] = useState<AnalyticsSeries | null>(null)
  const [pending, start] = useTransition()

  useEffect(() => {
    start(async () => {
      setData(await loadAnalyticsAction({ fromMs, toMs }))
    })
  }, [fromMs, toMs])

  useEffect(() => {
    onTable(
      data === null
        ? null
        : {
            name: 'genel-egilim',
            columns: ['Tarih', 'Rezervasyon', 'İptal', 'Taşıma', 'Check-in', 'Satış (₺)', 'Tahsilat (₺)'],
            rows: data.days.map((d) => [
              d.date,
              d.bookings,
              d.cancellations,
              d.moves,
              d.checkIns,
              d.salesKurus / 100,
              d.collectedKurus / 100,
            ]),
          },
    )
  }, [data, onTable])

  if (data === null || pending) {
    return (
      <p className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
        <Loader2Icon className="size-4 animate-spin" /> Hesaplanıyor…
      </p>
    )
  }

  return (
    <div className="space-y-6">
      <Section title="Günlük rezervasyon ve iptal">
        <Bars
          rows={data.days.map((d) => ({
            label: dayLabel(d.date),
            primary: d.bookings,
            secondary: d.cancellations,
          }))}
          primaryLabel="rezervasyon"
          secondaryLabel="iptal"
          empty="Bu aralıkta rezervasyon yok."
        />
      </Section>

      <Section title="Check-in trendi">
        <Bars
          rows={data.days.map((d) => ({ label: dayLabel(d.date), primary: d.checkIns, secondary: 0 }))}
          primaryLabel="check-in"
          empty="Bu aralıkta check-in yok."
        />
      </Section>

      <Section title="Günlük doluluk">
        <Bars
          rows={data.occupancyByDay.map((d) => ({
            label: dayLabel(d.date),
            primary: d.capacity > 0 ? Math.round((d.booked / d.capacity) * 100) : 0,
            secondary: 0,
            suffix: '%',
          }))}
          primaryLabel="doluluk %"
          empty="Bu aralıkta seans yok."
        />
      </Section>

      <Section title="Saat bazlı yoğunluk">
        <Bars
          rows={Object.entries(data.byHour).map(([hour, v]) => ({
            label: `${hour}:00`,
            primary: v.booked,
            secondary: Math.max(0, v.capacity - v.booked),
          }))}
          primaryLabel="dolu"
          secondaryLabel="boş"
          empty="Bu aralıkta seans yok."
        />
      </Section>

      <div className="grid gap-6 md:grid-cols-2">
        <Section title="Eğitmen yoğunluğu">
          {data.byTrainer.length === 0 ? (
            <p className="text-sm text-muted-foreground">Eğitmen atanmış seans yok.</p>
          ) : (
            <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
              {data.byTrainer.map((t) => (
                <li key={t.trainerId} className="flex items-center justify-between gap-2 px-3 py-2.5 text-sm">
                  <span className="truncate font-medium text-foreground">{t.name}</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {t.sessions} seans · {t.booked} rezervasyon
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Paket satış dağılımı">
          {data.salesByProduct.length === 0 ? (
            <p className="text-sm text-muted-foreground">Bu aralıkta satış yok.</p>
          ) : (
            <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
              {data.salesByProduct.map((p) => (
                <li key={p.productId} className="flex items-center justify-between gap-2 px-3 py-2.5 text-sm">
                  <span className="truncate font-medium text-foreground">{p.name}</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">{tl(p.amountKurus)}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </div>
  )
}

function Bars({
  rows,
  primaryLabel,
  secondaryLabel,
  empty,
}: {
  rows: readonly { label: string; primary: number; secondary: number; suffix?: string }[]
  primaryLabel: string
  secondaryLabel?: string
  empty: string
}) {
  const max = Math.max(1, ...rows.map((r) => r.primary + r.secondary))
  if (rows.length === 0 || max === 1) {
    return <p className="text-sm text-muted-foreground">{empty}</p>
  }
  return (
    <div className="space-y-2 rounded-xl border border-border bg-card p-3 shadow-sm">
      <div className="flex items-end gap-1 overflow-x-auto">
        {rows.map((r) => (
          <div key={r.label} className="flex min-w-6 flex-1 flex-col items-center gap-1">
            <span className="text-[0.625rem] tabular-nums text-muted-foreground">
              {r.primary > 0 ? `${r.primary}${r.suffix ?? ''}` : ''}
            </span>
            <span className="flex h-28 w-full flex-col justify-end overflow-hidden rounded-md bg-muted/50">
              {r.secondary > 0 ? (
                <span
                  className="w-full bg-muted-foreground/25"
                  style={{ height: `${(r.secondary / max) * 100}%` }}
                />
              ) : null}
              <span className="w-full bg-primary" style={{ height: `${(r.primary / max) * 100}%` }} />
            </span>
            <span className="truncate text-[0.625rem] tabular-nums text-muted-foreground">{r.label}</span>
          </div>
        ))}
      </div>
      <p className="flex gap-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <span className="size-2 rounded-sm bg-primary" /> {primaryLabel}
        </span>
        {secondaryLabel ? (
          <span className="flex items-center gap-1">
            <span className="size-2 rounded-sm bg-muted-foreground/25" /> {secondaryLabel}
          </span>
        ) : null}
      </p>
    </div>
  )
}
