import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

// PageHeader — the top of every list/detail/form screen (Doc 09 §8): a title
// (with optional description) on the left, the screen's single primary action on
// the right. The primary action is a visible button, never hidden in an overflow
// menu (Doc 09 §7).
function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  className?: string
}) {
  return (
    <div
      data-slot="page-header"
      className={cn(
        'flex flex-col gap-3 border-b border-border pb-4 sm:flex-row sm:items-center sm:justify-between',
        className,
      )}
    >
      <div className="space-y-1">
        <h1 className="text-xl font-semibold text-foreground">{title}</h1>
        {description ? (
          <p className="text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  )
}

export { PageHeader }
