'use client'

import { CheckIcon } from 'lucide-react'

import { cn } from '@/lib/utils'

// The wizard's spine. Seven steps, and the operator can always see which one she is on and how many
// are left — an import is a long, uncomfortable operation and "how much more of this" is the first
// question anyone asks.
//
// Desktop-only by design (owner, 2026-07-30). The mapping step is two columns of arrows; nobody maps
// forty columns on a phone, and pretending otherwise would mean building a version of this screen
// that is worse for the one device it will actually be used on.

export const STEPS = [
  { key: 'kind', label: 'Ne aktarılıyor' },
  { key: 'file', label: 'Dosya' },
  { key: 'header', label: 'Başlık satırı' },
  { key: 'mapping', label: 'Eşleştirme' },
  { key: 'gaps', label: 'Eksikler' },
  { key: 'match', label: 'Kime gidiyor' },
  { key: 'preview', label: 'Önizleme' },
] as const

export type StepKey = (typeof STEPS)[number]['key']

export function StepBar({ current, done, skip }: { current: StepKey; done: readonly StepKey[]; skip?: readonly StepKey[] }) {
  const visible = STEPS.filter((s) => !skip?.includes(s.key))
  return (
    <ol className="mb-6 flex flex-wrap items-center gap-x-2 gap-y-2 text-sm">
      {visible.map((s, i) => {
        const isDone = done.includes(s.key)
        const isCurrent = s.key === current
        return (
          <li key={s.key} className="flex items-center gap-2">
            <span
              className={cn(
                'flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums',
                isCurrent && 'bg-accent text-accent-foreground',
                isDone && !isCurrent && 'bg-success/15 text-success',
                !isDone && !isCurrent && 'bg-muted text-muted-foreground',
              )}
            >
              {isDone && !isCurrent ? <CheckIcon className="size-3.5" /> : i + 1}
            </span>
            <span className={cn('whitespace-nowrap', isCurrent ? 'font-medium text-foreground' : 'text-muted-foreground')}>
              {s.label}
            </span>
            {i < visible.length - 1 ? <span className="mx-1 text-muted-foreground/40">›</span> : null}
          </li>
        )
      })}
    </ol>
  )
}

/** A short, plain explanation under a step's title. The screen says what it is about to do. */
export function StepNote({ children }: { children: React.ReactNode }) {
  return <p className="mb-4 max-w-3xl text-sm text-muted-foreground">{children}</p>
}
