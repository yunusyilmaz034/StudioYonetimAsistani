'use client'

import { useState } from 'react'
import Link from 'next/link'
import {
  ArrowRightLeftIcon,
  BanIcon,
  BellIcon,
  CalendarIcon,
  CoinsIcon,
  HandIcon,
  CreditCardIcon,
  LayersIcon,
  LogInIcon,
  MessageSquareIcon,
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
  feedback: MessageSquareIcon,
  notification: BellIcon,
  manual: HandIcon,
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
        {/* Ada tıklayınca üyeye git (owner, 2026-09-16) — "kim bu" sorusu satırın kendisinden cevaplanır. */}
        {event.memberId ? (
          <p className="text-sm font-medium text-foreground">
            <Link href={`/members/${event.memberId}`} className="hover:underline">
              {p.title}
            </Link>
          </p>
        ) : (
          <p className="text-sm font-medium text-foreground">{p.title}</p>
        )}
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

// ── TEK İŞLEM, TEK SATIR (owner, 2026-09-16) ────────────────────────────────────────────────
//
// Bir satış aynı saniyede üç olay yazıyor: satış · tahsilat · mahsup. Owner: *"aynı isme ait işlemler peş peşe
// yapıldıysa gruplansın, bu şekilde anlaşılmıyor."* Ölçüt İŞLEM NUMARASI (`operationId`) — "aynı üye" değil:
// aynı üyenin iki ayrı satışı iki ayrı karardır ve tek satırda toplanırsa biri gizlenir.
//
// Gruplanan satır KAPALI gelir ve açılınca üç olayı da AYNEN gösterir; hiçbir hareket listeden kaybolmaz.
function groupByOperation(list: readonly ActivityEvent[]): ActivityEvent[][] {
  const out: ActivityEvent[][] = []
  for (const e of list) {
    const prev = out[out.length - 1]
    if (prev && e.operationId && prev[0]!.operationId === e.operationId) prev.push(e)
    else out.push([e])
  }
  return out
}

/** Bir işlemin bütün hareketleri: özet satır + açılınca tek tek olaylar. */
function OperationGroup({ events, showOperation }: { events: readonly ActivityEvent[]; showOperation: boolean }) {
  const [open, setOpen] = useState(false)
  const first = events[0]!
  const p = present(first)
  const Icon = ICON[p.kind] ?? BanIcon
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-start gap-3 px-3 py-3 text-left transition-colors hover:bg-primary-soft/30"
      >
        <span className={`mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg ${TONE[p.tone] ?? TONE.default}`}>
          <Icon className="size-3.5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-baseline gap-x-2 text-xs tabular-nums text-muted-foreground">
            <span>{formatTimeWithSeconds(first.occurredAt)}</span>
            <span className="font-medium text-foreground">{first.actorName}</span>
          </span>
          <span className="block text-sm font-medium text-foreground">{p.title}</span>
          <span className="block text-xs text-muted-foreground">{events.length} hareket · {open ? 'gizle' : 'ayrıntıyı aç'}</span>
        </span>
        {showOperation && first.operationId ? (
          <span className="mt-0.5 shrink-0 font-mono text-[0.6875rem] text-muted-foreground/80">{first.operationId.slice(-6)}</span>
        ) : null}
      </button>
      {open ? (
        <div className="divide-y divide-border border-t border-border bg-muted/20">
          {events.map((e) => (
            <ActivityRow key={e.eventId} event={e} showDate={false} showOperation={false} />
          ))}
        </div>
      ) : null}
    </div>
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
            {groupByOperation(list).map((g) =>
              g.length === 1 ? (
                <ActivityRow key={g[0]!.eventId} event={g[0]!} showDate={false} showOperation={showOperation} />
              ) : (
                <OperationGroup key={g[0]!.eventId} events={g} showOperation={showOperation} />
              ),
            )}
          </div>
        </section>
      ))}
    </div>
  )
}
