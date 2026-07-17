'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { HeartPulseIcon, PhoneCallIcon } from 'lucide-react'

import { Section } from '@/components/ui/section'
import type { ActivityDistribution, DormantRow } from '@/server/owner-dashboard'

// ── ÜYE NABZI (Phase 2 · the churn signal made visible) ───────────────────────────────────────
// The behavioural churn the whole event log was built to surface: of the members who are SUPPOSED to
// be here (active record + valid package), how recently did each actually come? A stacked pulse bar
// shows the spread; the list names the ones cooling off, so the owner can call before they are gone.
// "Normal is quiet, abnormal is loud" — a healthy studio shows a calm green bar and no list.

const AT_RISK_DAYS = 35

const BUCKETS = [
  { key: 'fresh', label: 'Taze', hint: 'son 1 hafta', bar: 'bg-emerald-500', dot: 'bg-emerald-500' },
  { key: 'steady', label: 'Düzenli', hint: '1–3 hafta', bar: 'bg-sky-500', dot: 'bg-sky-500' },
  { key: 'cooling', label: 'Soğuyor', hint: '3–5 hafta', bar: 'bg-amber-500', dot: 'bg-amber-500' },
  { key: 'atRisk', label: 'Riskli', hint: '5+ hafta', bar: 'bg-rose-500', dot: 'bg-rose-500' },
  { key: 'unrecorded', label: 'Kayıtsız', hint: 'aktivite yok', bar: 'bg-muted-foreground/25', dot: 'bg-muted-foreground/40' },
] as const

export function ChurnPulse({
  distribution,
  dormant,
}: {
  distribution: ActivityDistribution
  dormant: readonly DormantRow[]
}) {
  // Grow the bars from zero on mount — lively, but disabled under prefers-reduced-motion.
  const [shown, setShown] = useState(false)
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true))
    return () => cancelAnimationFrame(id)
  }, [])

  const total = distribution.total
  if (total === 0) return null // no active-package members yet — nothing to take a pulse of

  const { atRisk, cooling, fresh, steady } = distribution
  const drifting = atRisk + cooling
  const recorded = fresh + steady + drifting // members whose engagement we have actually seen

  // Three honest states: real churn to act on · everyone steady · we simply are not logging visits yet
  // (which is NOT churn — the amber alarm would be a lie, so it becomes a gentle nudge instead).
  const mode = drifting > 0 ? 'churn' : recorded > 0 ? 'healthy' : 'unlogged'
  const tone =
    mode === 'churn' ? 'bg-amber-500/12 text-amber-600' : mode === 'healthy' ? 'bg-emerald-500/12 text-emerald-600' : 'bg-muted text-muted-foreground'

  return (
    <Section
      title="Üye Nabzı"
      hint="Aktif paketi olan üyeler ne zaman geldi? Uzaklaşanları geç olmadan görün."
    >
      <div className="space-y-4 rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-5">
        {/* Headline — the one thing that matters, said in words. */}
        <div className="flex items-center gap-3">
          <span className={`flex size-10 shrink-0 items-center justify-center rounded-full ${tone}`}>
            <HeartPulseIcon className="size-5" />
          </span>
          <div className="min-w-0">
            {mode === 'churn' ? (
              <p className="text-sm">
                <span className="font-semibold text-foreground">{drifting} üye</span> uzaklaşıyor
                {atRisk > 0 ? <span className="text-rose-600"> — {atRisk} tanesi risk altında</span> : null}.
              </p>
            ) : mode === 'healthy' ? (
              <p className="text-sm font-medium">Herkes düzenli geliyor 💪</p>
            ) : (
              <p className="text-sm">
                Üye ziyaretleri henüz kaydedilmiyor.{' '}
                <span className="text-muted-foreground">Check-in ve rezervasyon oldukça nabız dolar.</span>
              </p>
            )}
            <p className="text-xs text-muted-foreground">{total} aktif üyelik üzerinden</p>
          </div>
        </div>

        {/* The pulse bar — a stacked, proportional spread of the four recency bands. */}
        <div>
          <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted">
            {BUCKETS.map((b) => {
              const value = distribution[b.key]
              const pct = shown ? (value / total) * 100 : 0
              return (
                <div
                  key={b.key}
                  className={`h-full ${b.bar} transition-[width] duration-700 ease-out motion-reduce:transition-none`}
                  style={{ width: `${pct}%` }}
                  title={`${b.label}: ${value}`}
                />
              )
            })}
          </div>
          {/* Legend — counts under swatches, tabular so they line up. */}
          <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3 lg:grid-cols-5">
            {BUCKETS.map((b) => (
              <div key={b.key} className="flex items-center gap-2 text-xs">
                <span className={`size-2.5 shrink-0 rounded-full ${b.dot}`} />
                <span className="font-medium text-foreground tabular-nums">{distribution[b.key]}</span>
                <span className="truncate text-muted-foreground">
                  {b.label} <span className="hidden sm:inline">· {b.hint}</span>
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Who to call — cooling and at-risk members, most-overdue first. */}
        {dormant.length > 0 ? (
          <ul className="space-y-1 border-t border-border pt-3">
            {dormant.slice(0, 8).map((m) => {
              const risky = m.daysSinceActivity >= AT_RISK_DAYS
              return (
                <li key={m.id}>
                  <Link
                    href={`/members/${m.id}`}
                    className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-muted"
                  >
                    <span className={`size-2 shrink-0 rounded-full ${risky ? 'bg-rose-500' : 'bg-amber-500'}`} />
                    <span className="min-w-0 flex-1 truncate font-medium text-foreground">{m.name}</span>
                    <span className={`shrink-0 tabular-nums ${risky ? 'text-rose-600' : 'text-amber-600'}`}>
                      {m.daysSinceActivity} gün
                    </span>
                    <PhoneCallIcon className="size-3.5 shrink-0 text-muted-foreground" />
                  </Link>
                </li>
              )
            })}
            {dormant.length > 8 ? (
              <li className="px-2 pt-1 text-xs text-muted-foreground">+{dormant.length - 8} üye daha</li>
            ) : null}
          </ul>
        ) : null}
      </div>
    </Section>
  )
}
