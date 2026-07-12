'use client'

import Link from 'next/link'
import {
  ArrowRightLeftIcon,
  BanIcon,
  CalendarIcon,
  CoinsIcon,
  CreditCardIcon,
  LayersIcon,
  LogInIcon,
  SettingsIcon,
  UserIcon,
  type LucideIcon,
} from 'lucide-react'

import { formatDateTime, formatTimeWithSeconds } from '@/lib/datetime'
import { present } from '@/lib/activity/present'
import type { ActivityEvent, ActivityKind } from '@/server/activity-query'

// One row, used by every screen in the Operations Center. It renders a SENTENCE — never an event
// type, never a payload (owner rules 1 & 6). Three facts, in the order the eye needs them:
//
//   1. WHEN — to the second (OP-1)
//   2. WHO  — the staff member who did it, by name
//   3. WHAT — one Turkish sentence, plus the supporting detail and the reason (OP-3)
//
// and, quietly on the right, the OperationId — clickable, because "what else did this act do?" is
// the question the owner asks next (OP-2).

const ICON: Record<ActivityKind, LucideIcon> = {
  reservation: CalendarIcon,
  membership: UserIcon,
  payment: CreditCardIcon,
  credit: CoinsIcon,
  checkin: LogInIcon,
  operation: LayersIcon,
  schedule: ArrowRightLeftIcon,
  system: SettingsIcon,
}

const TONE: Record<string, string> = {
  default: 'bg-muted text-muted-foreground',
  success: 'bg-success/10 text-success',
  warning: 'bg-warning/10 text-warning',
  danger: 'bg-danger/10 text-danger',
  info: 'bg-info/10 text-info',
}

export function ActivityRow({
  event,
  showDate = true,
  showOperation = true,
}: {
  event: ActivityEvent
  showDate?: boolean
  showOperation?: boolean
}) {
  const p = present(event)
  const Icon = ICON[p.kind] ?? BanIcon

  return (
    <article className="flex items-start gap-3 px-3 py-3 transition-colors hover:bg-primary-soft/30">
      <span className={`mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg ${TONE[p.tone] ?? TONE.default}`}>
        <Icon className="size-3.5" />
      </span>

      <div className="min-w-0 flex-1">
        {/* OP-1 — the full timestamp, to the second. No milliseconds. */}
        <p className="flex flex-wrap items-baseline gap-x-2 text-xs tabular-nums text-muted-foreground">
          <span>{showDate ? formatDateTime(event.occurredAt) : formatTimeWithSeconds(event.occurredAt)}</span>
          <span className="font-medium text-foreground">{event.actorName}</span>
        </p>
        <p className="text-sm font-medium text-foreground">{p.title}</p>
        {p.detail ? <p className="text-xs text-muted-foreground">{p.detail}</p> : null}
      </div>

      {showOperation && event.operationId ? (
        <Link
          href={`/operations/${event.operationId}`}
          title="Bu işlemin tüm hareketlerini gör"
          className="mt-0.5 shrink-0 rounded-md px-1.5 py-0.5 font-mono text-[0.6875rem] text-muted-foreground/80 transition-colors hover:bg-muted hover:text-primary"
        >
          {event.operationId.slice(-6)}
        </Link>
      ) : null}
    </article>
  )
}

// The list, grouped by day. A day header is cheaper to read than a repeated date on every row —
// and reception spends the whole day inside "today".
export function ActivityList({
  events,
  emptyLabel = 'Kayıt yok.',
  showOperation = true,
}: {
  events: readonly ActivityEvent[]
  emptyLabel?: string
  showOperation?: boolean
}) {
  if (events.length === 0) {
    return <p className="px-3 py-6 text-center text-sm text-muted-foreground">{emptyLabel}</p>
  }
  const days = new Map<string, ActivityEvent[]>()
  for (const e of events) {
    const day = formatDateTime(e.occurredAt).slice(0, 10)
    const list = days.get(day) ?? []
    list.push(e)
    days.set(day, list)
  }

  return (
    <div className="space-y-4">
      {[...days.entries()].map(([day, list]) => (
        <section key={day} className="space-y-1.5">
          <h3 className="px-1 text-xs font-semibold tabular-nums text-muted-foreground">{day}</h3>
          <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card shadow-sm">
            {list.map((e) => (
              <ActivityRow key={e.eventId} event={e} showDate={false} showOperation={showOperation} />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
