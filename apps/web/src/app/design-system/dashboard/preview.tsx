'use client'

import type { CSSProperties, ReactNode } from 'react'
import {
  AlertTriangleIcon,
  ArrowUpRightIcon,
  BanknoteIcon,
  CalendarCheckIcon,
  SparklesIcon,
  TrendingUpIcon,
  UsersIcon,
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { AreaChart, DonutChart, FillBar, Sparkline } from '@/components/ui/chart'

// A DEV-ONLY, vibrant preview of the Plus owner dashboard (Doc 32 Phase 1). It renders the real
// component + chart system on rich sample data, so Işıl can see the design language full and alive
// without a login or a database. Numbers here are illustrative, not real. When the direction is
// signed off, this composition moves into the actual `dashboard-screen.tsx`.

const rise = (i: number): CSSProperties => ({ animationDelay: `${i * 70}ms` })

function Panel({ children, className, i = 0 }: { children: ReactNode; className?: string; i?: number }) {
  return (
    <div className={`fade-rise ${className ?? ''}`} style={rise(i)}>
      {children}
    </div>
  )
}

function Kpi({
  label,
  value,
  delta,
  spark,
  icon: Icon,
  i,
}: {
  label: string
  value: string
  delta: string
  spark: readonly number[]
  icon: typeof UsersIcon
  i: number
}) {
  return (
    <Panel i={i}>
      <Card className="group/kpi gap-0 p-5 transition-shadow duration-300 hover:shadow-md">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-[0.6875rem] font-medium tracking-wide text-muted-foreground uppercase">
            <Icon className="size-3.5" />
            {label}
          </span>
          <span className="flex items-center gap-0.5 text-xs font-medium text-success">
            <ArrowUpRightIcon className="size-3" />
            {delta}
          </span>
        </div>
        <p className="mt-2 font-heading text-display font-medium tabular-nums text-foreground">{value}</p>
        <div className="mt-3">
          <Sparkline data={spark} />
        </div>
      </Card>
    </Panel>
  )
}

const OCCUPANCY = [72, 78, 65, 84, 88, 91, 60] as const
const OCC_LABELS = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'] as const
const REVENUE = [8200, 9400, 7100, 11200, 12400, 13800, 6200] as const

const CLASSES = [
  { time: '09:00', name: 'Reformer', cat: 'Pilates', trainer: 'IY', filled: 6, cap: 8 },
  { time: '10:00', name: 'Reformer', cat: 'Pilates', trainer: 'RH', filled: 8, cap: 8 },
  { time: '12:00', name: 'Düet', cat: 'Pilates', trainer: 'BH', filled: 2, cap: 2 },
  { time: '14:00', name: 'PT', cat: 'Özel', trainer: 'IY', filled: 1, cap: 1 },
  { time: '18:00', name: 'Reformer', cat: 'Pilates', trainer: 'RH', filled: 7, cap: 8 },
  { time: '19:00', name: 'Reformer', cat: 'Pilates', trainer: 'BH', filled: 5, cap: 8 },
] as const

const AVATAR_BG: Record<string, string> = {
  IY: 'from-primary to-primary-hover',
  RH: 'from-cat-fitness to-success',
  BH: 'from-gold to-cat-private',
}

export function DashboardPreview() {
  return (
    <div className="min-h-dvh bg-background">
      <div className="mx-auto max-w-6xl space-y-6 p-4 pb-16 sm:p-6 lg:p-8">
        {/* ── greeting ────────────────────────────────────────────────── */}
        <Panel i={0}>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-sm text-muted-foreground">Salı, 15 Temmuz</p>
              <h1 className="font-heading text-display font-medium text-foreground">İyi sabahlar, Işıl</h1>
            </div>
            <Badge className="gap-1 bg-gold-soft text-gold">
              <SparklesIcon className="size-3" />
              Premium
            </Badge>
          </div>
        </Panel>

        {/* ── attention strip ─────────────────────────────────────────── */}
        <Panel i={1}>
          <div className="flex items-start gap-2 rounded-xl border border-warning/25 bg-warning/5 px-4 py-3 text-sm">
            <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-warning" />
            <span className="text-foreground">
              <span className="font-medium">Bugün ilgilenmen gerekenler:</span>{' '}
              <span className="text-muted-foreground">3 borçlu üye · 2 paket bu hafta bitiyor · 1 düşük kredili üye.</span>
            </span>
          </div>
        </Panel>

        {/* ── KPI row ─────────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Kpi i={2} label="Bugünkü Ciro" value="12.400 ₺" delta="%12" spark={REVENUE} icon={BanknoteIcon} />
          <Kpi i={3} label="Haftalık Doluluk" value="%86" delta="%4" spark={OCCUPANCY} icon={TrendingUpIcon} />
          <Kpi i={4} label="Aktif Üye" value="147" delta="8" spark={[128, 131, 134, 138, 141, 144, 147]} icon={UsersIcon} />
          <Kpi i={5} label="Yoklama Oranı" value="%92" delta="%3" spark={[86, 88, 85, 90, 89, 91, 92]} icon={CalendarCheckIcon} />
        </div>

        {/* ── main graph + donut ──────────────────────────────────────── */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Panel i={6} className="lg:col-span-2">
            <Card className="h-full p-5">
              <div className="mb-1 flex items-baseline justify-between">
                <h2 className="font-heading text-h2 font-medium text-foreground">Haftalık Doluluk</h2>
                <span className="text-xs text-muted-foreground">Son 7 gün · ortalama %78</span>
              </div>
              <AreaChart data={OCCUPANCY} labels={OCC_LABELS} height={200} />
            </Card>
          </Panel>
          <Panel i={7}>
            <Card className="flex h-full flex-col items-center justify-center gap-4 p-5">
              <h2 className="self-start font-heading text-h2 font-medium text-foreground">Ders Dağılımı</h2>
              <DonutChart
                centerValue="184"
                centerLabel="bu hafta"
                segments={[
                  { value: 58, colorClass: 'text-cat-pilates', label: 'Pilates' },
                  { value: 30, colorClass: 'text-cat-fitness', label: 'Fitness' },
                  { value: 12, colorClass: 'text-cat-private', label: 'Özel' },
                ]}
              />
              <div className="flex w-full flex-col gap-1.5 text-sm">
                <LegendRow color="bg-cat-pilates" label="Pilates" value="%58" />
                <LegendRow color="bg-cat-fitness" label="Fitness" value="%30" />
                <LegendRow color="bg-cat-private" label="Özel Ders" value="%12" />
              </div>
            </Card>
          </Panel>
        </div>

        {/* ── revenue bars + today's classes ──────────────────────────── */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Panel i={8}>
            <Card className="h-full p-5">
              <h2 className="mb-4 font-heading text-h2 font-medium text-foreground">Günlük Tahsilat</h2>
              <div className="flex h-40 items-end gap-2">
                {REVENUE.map((v, i) => {
                  const pct = Math.round((v / Math.max(...REVENUE)) * 100)
                  return (
                    <div key={i} className="flex flex-1 flex-col items-center gap-1.5">
                      <div className="flex h-full w-full items-end">
                        <div
                          className={`chart-rise w-full rounded-t-md ${i === 5 ? 'bg-primary' : 'bg-primary/35'}`}
                          style={{ height: `${pct}%`, animationDelay: `${i * 60}ms` } as CSSProperties}
                        />
                      </div>
                      <span className="text-[10px] text-muted-foreground">{OCC_LABELS[i]}</span>
                    </div>
                  )
                })}
              </div>
            </Card>
          </Panel>

          <Panel i={9} className="lg:col-span-2">
            <Card className="h-full p-5">
              <div className="mb-4 flex items-baseline justify-between">
                <h2 className="font-heading text-h2 font-medium text-foreground">Bugünkü Dersler</h2>
                <span className="text-xs text-muted-foreground">6 ders · 29 rezervasyon</span>
              </div>
              <ul className="space-y-3.5">
                {CLASSES.map((c, i) => (
                  <li key={i} className="flex items-center gap-3">
                    <span className="w-12 shrink-0 font-heading text-sm tabular-nums text-muted-foreground">{c.time}</span>
                    <span
                      className={`grid size-8 shrink-0 place-items-center rounded-full bg-gradient-to-br ${AVATAR_BG[c.trainer]} text-[0.7rem] font-semibold text-primary-foreground`}
                    >
                      {c.trainer}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-sm font-medium text-foreground">
                          {c.name} <span className="text-muted-foreground">· {c.cat}</span>
                        </span>
                        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                          {c.filled}/{c.cap}
                        </span>
                      </div>
                      <FillBar value={c.filled} max={c.cap} className="mt-1.5" />
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          </Panel>
        </div>

        {/* ── the dark-surface premium moment (Doc 33) ────────────────── */}
        <Panel i={10}>
          <div className="relative overflow-hidden rounded-xl p-6 shadow-lg" style={{ background: '#1a1315' }}>
            <div
              aria-hidden
              className="pointer-events-none absolute -top-24 -right-10 size-80 rounded-full opacity-60 blur-3xl"
              style={{ background: 'radial-gradient(circle, rgba(226,122,162,0.35), transparent 60%)' }}
            />
            <p className="relative text-[0.6875rem] font-medium tracking-wide uppercase" style={{ color: '#d7a85a' }}>
              Bu ay
            </p>
            <div className="relative mt-3 grid grid-cols-2 gap-6 sm:grid-cols-4">
              <DarkStat value="147" label="Aktif üye" />
              <DarkStat value="%86" label="Doluluk" accent />
              <DarkStat value="284k ₺" label="Aylık ciro" gold />
              <DarkStat value="%92" label="Yoklama" />
            </div>
          </div>
        </Panel>
      </div>
    </div>
  )
}

function LegendRow({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className={`size-2.5 rounded-full ${color}`} />
      <span className="flex-1 text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums text-foreground">{value}</span>
    </div>
  )
}

function DarkStat({ value, label, accent, gold }: { value: string; label: string; accent?: boolean; gold?: boolean }) {
  const color = gold ? '#d7a85a' : accent ? '#e27aa2' : '#f3e9e9'
  return (
    <div className="relative">
      <div className="font-heading text-2xl font-medium tabular-nums" style={{ color }}>
        {value}
      </div>
      <div className="mt-1 text-xs" style={{ color: '#b39ca2' }}>
        {label}
      </div>
    </div>
  )
}
