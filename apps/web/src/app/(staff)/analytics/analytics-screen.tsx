'use client'

import { useEffect, useState, useTransition } from 'react'
import { DownloadIcon, Loader2Icon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PageHeader } from '@/components/ui/page-header'
import { Section } from '@/components/ui/section'
import { downloadCsv } from '@/lib/export/csv'
import { RANGES, resolveRange, type RangeId } from '@/lib/ranges'
import { tl, type ExportableTable } from '@/lib/widgets/contract'
import { loadAnalyticsAction, type AnalyticsSeries } from '@/server/actions/analytics'

// The charts are hand-drawn SVG on purpose: a charting library is 60–200 kB for six bar charts, and
// this screen must stay cheap enough that the owner opens it on a phone between classes.

const dayLabel = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}`

export function AnalyticsScreen() {
  const [range, setRange] = useState<RangeId>('last30')
  const [custom, setCustom] = useState<{ from: string; to: string }>({ from: '', to: '' })
  const [data, setData] = useState<AnalyticsSeries | null>(null)
  const [pending, start] = useTransition()

  useEffect(() => {
    const r = resolveRange(range, Date.now(), custom)
    start(async () => {
      setData(await loadAnalyticsAction({ fromMs: r.fromMs, toMs: r.toMs }))
    })
  }, [range, custom])

  // Export is a WRITER over the table, never a second screen (owner, v1.23). Excel and PDF plug in
  // here without touching a chart.
  const exportTable = (): ExportableTable | null =>
    data === null
      ? null
      : {
          name: `analiz-${range}`,
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
        }

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="Analiz"
        description="Tüm sayılar event kayıtlarından üretilir; hiçbiri elle tutulmaz."
        actions={
          <Button
            variant="outline"
            disabled={data === null || data.days.length === 0}
            onClick={() => {
              const t = exportTable()
              if (t) downloadCsv(t)
            }}
          >
            <DownloadIcon />
            CSV
          </Button>
        }
      />

      {/* One range vocabulary for every chart on the screen — and the same one the feed uses. */}
      <div className="flex flex-wrap items-center gap-1.5">
        {RANGES.map((r) => (
          <Button
            key={r.id}
            size="sm"
            variant={range === r.id ? 'default' : 'outline'}
            onClick={() => setRange(r.id)}
          >
            {r.label}
          </Button>
        ))}
        {range === 'custom' ? (
          <>
            <Input
              type="date"
              className="w-40"
              value={custom.from}
              onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))}
            />
            <span className="text-sm text-muted-foreground">–</span>
            <Input
              type="date"
              className="w-40"
              value={custom.to}
              onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))}
            />
          </>
        ) : null}
      </div>

      {data === null || pending ? (
        <p className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2Icon className="size-4 animate-spin" /> Hesaplanıyor…
        </p>
      ) : (
        <>
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
        </>
      )}
    </main>
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
