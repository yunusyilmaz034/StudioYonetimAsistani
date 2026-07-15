'use client'

import { GaugeIcon, TrendingUpIcon, UsersIcon } from 'lucide-react'
import { useMemo } from 'react'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Metric, MetricStrip } from '@/components/ui/metric'
import { PageHeader } from '@/components/ui/page-header'
import { Section } from '@/components/ui/section'
import { OCCUPANCY_LABEL, OCCUPANCY_TONE, WEEKDAY_SHORT, hhLabel } from '@/lib/fitness-labels'
import type { OccupancyNow, StudioUsage } from '@/server/fitness-query'

// The hours a heatmap column exists for: only those that actually saw a check-in, so a studio that
// runs 08:00–22:00 does not stare at twelve empty night columns.
function usedHours(usage: StudioUsage): number[] {
  const set = new Set(usage.histogram.map((b) => b.hour))
  return [...set].sort((a, b) => a - b)
}

export function FitnessScreen({ occupancy, usage }: { occupancy: OccupancyNow; usage: StudioUsage }) {
  const hours = useMemo(() => usedHours(usage), [usage])
  const grid = useMemo(() => {
    const m = new Map<string, number>()
    for (const b of usage.histogram) m.set(`${b.weekday}:${b.hour}`, b.count)
    return m
  }, [usage])
  const max = useMemo(() => usage.histogram.reduce((mx, b) => Math.max(mx, b.count), 0), [usage])
  const busiest = usage.busiest[0]
  const busiestWeekday = useMemo(() => {
    let best = -1
    let idx = 0
    usage.visitsPerWeekday.forEach((v, i) => {
      if (v > best) {
        best = v
        idx = i
      }
    })
    return best > 0 ? WEEKDAY_SHORT[idx] ?? '—' : '—'
  }, [usage])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Katılım & Doluluk"
        description="Stüdyonun şu anki doluluğu ve son 30 günün kullanım özeti. Giriş kayıtlarından okunur — tahminler geçmişe göredir."
      />

      {/* ── Live occupancy hero ─────────────────────────────────────────────────────────── */}
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-4 p-5">
          <div className="flex items-center gap-4">
            <span className="grid size-12 place-items-center rounded-xl bg-primary-soft text-primary">
              <GaugeIcon className="size-6" />
            </span>
            <div>
              <p className="text-[0.6875rem] font-medium uppercase tracking-wide text-muted-foreground">
                Şu an stüdyoda
              </p>
              <p className="font-heading text-display font-medium tabular-nums text-foreground">
                {occupancy.occupancy}
                {occupancy.capacity > 0 ? (
                  <span className="text-h3 text-muted-foreground"> / {occupancy.capacity}</span>
                ) : null}
                <span className="ml-1 text-h3 text-muted-foreground">kişi</span>
              </p>
            </div>
          </div>
          {occupancy.level ? (
            <Badge className={`${OCCUPANCY_TONE[occupancy.level]} px-3 py-1 text-sm`}>
              {OCCUPANCY_LABEL[occupancy.level]}
            </Badge>
          ) : (
            <p className="max-w-xs text-sm text-muted-foreground">
              Doluluk seviyesi için kapasite tanımlı değil. Ayarlar → Doluluk &amp; Kapasite’den girin.
            </p>
          )}
        </CardContent>
      </Card>

      {/* ── 30-day summary ──────────────────────────────────────────────────────────────── */}
      <MetricStrip>
        <Metric label="Toplam giriş (30g)" value={usage.totalVisits} icon={TrendingUpIcon} />
        <Metric label="Farklı üye" value={usage.uniqueMembers} icon={UsersIcon} />
        <Metric label="En yoğun gün" value={busiestWeekday} />
        <Metric label="En yoğun saat" value={busiest ? hhLabel(busiest.hour) : '—'} />
      </MetricStrip>

      {/* ── Busiest hours heatmap ───────────────────────────────────────────────────────── */}
      <Section title="Yoğunluk haritası" hint="son 30 gün · geçmişe göre, garanti değil">
        {usage.totalVisits === 0 ? (
          <Card>
            <CardContent className="py-1 text-sm text-muted-foreground">
              Henüz giriş kaydı yok. Üyeler geldikçe burada gün ve saat bazında yoğunluk oluşur.
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="overflow-x-auto p-4">
              <table className="border-separate border-spacing-1">
                <thead>
                  <tr>
                    <th className="w-10" />
                    {hours.map((h) => (
                      <th key={h} className="text-[0.625rem] font-medium tabular-nums text-muted-foreground">
                        {String(h).padStart(2, '0')}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {WEEKDAY_SHORT.map((label, wd) => (
                    <tr key={wd}>
                      <td className="pr-1 text-right text-[0.6875rem] font-medium text-muted-foreground">{label}</td>
                      {hours.map((h) => {
                        const count = grid.get(`${wd}:${h}`) ?? 0
                        const intensity = max > 0 ? count / max : 0
                        return (
                          <td key={h}>
                            <div
                              title={count > 0 ? `${label} ${hhLabel(h)} · ${count} giriş` : `${label} ${hhLabel(h)}`}
                              className="size-6 rounded-[4px] border border-border/40"
                              style={{
                                backgroundColor:
                                  count === 0
                                    ? 'transparent'
                                    : `color-mix(in oklab, var(--color-primary) ${Math.round(20 + intensity * 80)}%, transparent)`,
                              }}
                            />
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}
      </Section>

      {/* ── Top buckets, spelled out ────────────────────────────────────────────────────── */}
      {usage.busiest.length > 0 ? (
        <Section title="En yoğun zaman dilimleri">
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card text-sm shadow-sm">
            {usage.busiest.map((b) => (
              <li key={`${b.weekday}:${b.hour}`} className="flex items-center justify-between px-4 py-2.5">
                <span className="font-medium text-foreground">
                  {WEEKDAY_SHORT[b.weekday]} · {hhLabel(b.hour)}
                </span>
                <span className="tabular-nums text-muted-foreground">{b.count} giriş</span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </div>
  )
}
