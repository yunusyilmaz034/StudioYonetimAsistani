'use client'

import { useId, type CSSProperties } from 'react'

import { cn } from '@/lib/utils'

// The chart system (Plus DS v3, Doc 33 · Doc 32 Phase 1). Hand-authored SVG, token-driven — every
// stroke/fill inherits a colour token via `currentColor`, so a chart moves with the palette like any
// other component (DS-1). No chart library: these are a few dozen lines of geometry, and owning them
// is what lets them carry the warm, editorial treatment rather than a vendor's default look.
//
// Motion is a gentle draw/rise on mount; `prefers-reduced-motion` turns it off (see globals.css).

function scaleY(v: number, min: number, max: number, top: number, bottom: number): number {
  const range = max - min || 1
  return top + (bottom - top) * (1 - (v - min) / range)
}

// ── Sparkline — a KPI card's tiny trend. Area fill + line + emphasised endpoint. ───────────────
export function Sparkline({
  data,
  className,
  strokeWidth = 2,
}: {
  data: readonly number[]
  className?: string
  strokeWidth?: number
}) {
  const id = useId()
  const w = 120
  const h = 36
  const pad = 3
  const min = Math.min(...data)
  const max = Math.max(...data)
  const step = (w - pad * 2) / (data.length - 1)
  const pts = data.map((v, i) => [pad + i * step, scaleY(v, min, max, pad, h - pad)] as const)
  const line = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  const area = `${line} L${pts[pts.length - 1]![0].toFixed(1)},${h} L${pts[0]![0].toFixed(1)},${h} Z`
  const [ex, ey] = pts[pts.length - 1]!

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      className={cn('h-9 w-full text-primary', className)}
      aria-hidden
    >
      <defs>
        <linearGradient id={`spark-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="currentColor" stopOpacity="0.24" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#spark-${id})`} />
      <path
        d={line}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      <circle cx={ex} cy={ey} r="2.6" fill="currentColor" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

// ── AreaChart — the dashboard's main graph. Faint grid, gradient area, drawn line, x labels. ───
export function AreaChart({
  data,
  labels,
  className,
  height = 180,
}: {
  data: readonly number[]
  labels: readonly string[]
  className?: string
  height?: number
}) {
  const id = useId()
  const w = 640
  const h = height
  const padX = 8
  const padTop = 14
  const padBottom = 26
  const min = Math.min(...data, 0)
  const max = Math.max(...data)
  const step = (w - padX * 2) / (data.length - 1)
  const pts = data.map((v, i) => [padX + i * step, scaleY(v, min, max, padTop, h - padBottom)] as const)
  const line = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  const area = `${line} L${(w - padX).toFixed(1)},${h - padBottom} L${padX},${h - padBottom} Z`
  const grid = [0, 0.25, 0.5, 0.75, 1].map((t) => padTop + (h - padBottom - padTop) * t)

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={cn('w-full text-primary', className)} role="img">
      <defs>
        <linearGradient id={`area-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="currentColor" stopOpacity="0.22" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      {grid.map((y, i) => (
        <line
          key={i}
          x1={padX}
          x2={w - padX}
          y1={y}
          y2={y}
          className="text-border"
          stroke="currentColor"
          strokeWidth="1"
          strokeDasharray={i === grid.length - 1 ? '0' : '3 4'}
          vectorEffect="non-scaling-stroke"
        />
      ))}
      <path d={area} fill={`url(#area-${id})`} className="chart-rise" />
      <path
        d={line}
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
        className="chart-draw"
      />
      {pts.map(([x, y], i) => (
        <circle
          key={i}
          cx={x}
          cy={y}
          r={i === pts.length - 1 ? 4 : 2.5}
          fill="currentColor"
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {labels.map((lab, i) => (
        <text
          key={i}
          x={padX + i * step}
          y={h - 8}
          textAnchor="middle"
          className="fill-muted-foreground text-[11px]"
          style={{ fontSize: 11 } as CSSProperties}
        >
          {lab}
        </text>
      ))}
    </svg>
  )
}

// ── DonutChart — a categorical split (e.g. class categories). Segments carry a colour token. ───
export function DonutChart({
  segments,
  className,
  size = 148,
  centerLabel,
  centerValue,
}: {
  segments: readonly { readonly value: number; readonly colorClass: string; readonly label: string }[]
  className?: string
  size?: number
  centerLabel?: string
  centerValue?: string
}) {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1
  const r = 56
  const c = 2 * Math.PI * r
  let offset = 0
  return (
    <div className={cn('relative inline-grid place-items-center', className)} style={{ width: size, height: size }}>
      <svg viewBox="0 0 148 148" className="size-full -rotate-90">
        <circle cx="74" cy="74" r={r} fill="none" strokeWidth="18" className="text-muted" stroke="currentColor" />
        {segments.map((seg, i) => {
          const len = (seg.value / total) * c
          const dash = `${len} ${c - len}`
          const el = (
            <circle
              key={i}
              cx="74"
              cy="74"
              r={r}
              fill="none"
              strokeWidth="18"
              strokeLinecap="round"
              className={seg.colorClass}
              stroke="currentColor"
              strokeDasharray={dash}
              strokeDashoffset={-offset}
            />
          )
          offset += len
          return el
        })}
      </svg>
      {centerValue ? (
        <div className="absolute text-center">
          <div className="font-heading text-xl font-medium tabular-nums text-foreground">{centerValue}</div>
          {centerLabel ? <div className="text-[11px] text-muted-foreground">{centerLabel}</div> : null}
        </div>
      ) : null}
    </div>
  )
}

// ── FillBar — a horizontal capacity bar (a class's occupancy). ─────────────────────────────────
export function FillBar({ value, max, className }: { value: number; max: number; className?: string }) {
  const pct = Math.min(100, Math.round((value / (max || 1)) * 100))
  const tone = pct >= 100 ? 'bg-gold' : pct >= 75 ? 'bg-primary' : 'bg-primary/55'
  return (
    <div className={cn('h-1.5 w-full overflow-hidden rounded-full bg-muted', className)}>
      <div className={cn('h-full rounded-full transition-[width] duration-700', tone)} style={{ width: `${pct}%` }} />
    </div>
  )
}
