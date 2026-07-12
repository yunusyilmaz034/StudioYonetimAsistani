import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

// A section header (DS v2, Doc 20 §5) — the house pattern for grouping a screen into
// meaningful zones. Grouping is carried by a quiet label and whitespace, not by another
// box or rule: fewer lines, more structure.
function Section({
  title,
  hint,
  actions,
  children,
  className,
}: {
  title: string
  hint?: string
  actions?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={cn('space-y-3', className)}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="flex items-baseline gap-2">
          <span className="text-h3 font-semibold text-foreground">{title}</span>
          {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
        </h2>
        {actions ?? null}
      </div>
      {children}
    </section>
  )
}

export { Section }
