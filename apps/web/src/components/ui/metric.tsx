import Link from 'next/link'
import type { ComponentType, ReactNode, SVGProps } from 'react'

import { cn } from '@/lib/utils'

// The metric block (DS v2, Doc 20 §5) — the house pattern for a screen's headline numbers.
// A MetricStrip is ONE surface holding several metrics, not several boxes: the numbers read
// as a single instrument panel. The separators are hairlines produced by a 1px grid gap over
// the border colour, so they land correctly in both the 2×2 (mobile) and 1×4 (desktop)
// layouts. A metric with an `href` is a navigation target; without one it is inert.

type MetricTone = 'default' | 'warning' | 'danger' | 'success'

const TONE: Record<MetricTone, string> = {
  default: 'text-foreground',
  warning: 'text-warning',
  danger: 'text-danger',
  success: 'text-success',
}

interface MetricProps {
  readonly label: string
  readonly value: number | string
  readonly icon?: ComponentType<SVGProps<SVGSVGElement>>
  readonly href?: string
  /** Colours the value — only when the number itself carries an operational meaning. */
  readonly tone?: MetricTone
  /** Dense screens (the calendars) use the compact size so the strip never pushes work below the fold. */
  readonly compact?: boolean
}

function Metric({ label, value, icon: Icon, href, tone = 'default', compact }: MetricProps) {
  // The number is the point of a metric, so it carries the weight: the label is demoted to a
  // quiet caption above it, the value is the largest, heaviest thing in the block.
  const body = (
    <>
      <div className="flex items-center gap-1.5 text-muted-foreground">
        {Icon ? <Icon className="size-3.5 shrink-0" /> : null}
        <span className="truncate text-[0.6875rem] font-medium tracking-wide uppercase">{label}</span>
      </div>
      {/* The headline number is editorial: serif, tabular, the largest thing in the block (Doc 33).
          Serif gauge numerals are the "lüks/sakin" register Işıl approved. */}
      <p
        className={cn(
          'font-heading font-medium tabular-nums',
          compact ? 'mt-1 text-h1' : 'mt-2 text-display',
          TONE[tone],
        )}
      >
        {value}
      </p>
    </>
  )

  const shell = cn('block bg-card', compact ? 'px-4 py-3' : 'px-4 py-4 sm:px-5')

  return href ? (
    <Link href={href} className={cn(shell, 'transition-colors hover:bg-muted/50')}>
      {body}
    </Link>
  ) : (
    <div className={shell}>{body}</div>
  )
}

function MetricStrip({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border shadow-sm sm:grid-cols-4',
        className,
      )}
    >
      {children}
    </div>
  )
}

export { Metric, MetricStrip }
