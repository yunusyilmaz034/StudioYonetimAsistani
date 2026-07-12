'use client'

import { useEffect, useState } from 'react'
import { HistoryIcon, Loader2Icon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { ActivityList } from '@/components/activity/activity-row'
import type { ActivityEvent, ActivityKind } from '@/server/activity-query'

// A timeline — one aggregate's whole life, read from the event log through a Server Action (the
// client never touches /events; OQ-1). Used by the Member, Package and Reservation timelines: the
// only difference between them is which loader they are handed.

const FILTERS: readonly { kind: ActivityKind; label: string }[] = [
  { kind: 'reservation', label: 'Rezervasyonlar' },
  { kind: 'membership', label: 'Üyelikler' },
  { kind: 'payment', label: 'Ödemeler' },
  { kind: 'credit', label: 'Krediler' },
  { kind: 'operation', label: 'Toplu İşlemler' },
  { kind: 'checkin', label: 'Check-in' },
]

export function Timeline({
  load,
  filterable = false,
  emptyLabel = 'Henüz kayıt yok.',
}: {
  load: () => Promise<readonly ActivityEvent[]>
  filterable?: boolean
  emptyLabel?: string
}) {
  const [events, setEvents] = useState<readonly ActivityEvent[] | null>(null)
  const [kinds, setKinds] = useState<readonly ActivityKind[]>([])

  useEffect(() => {
    let live = true
    void load()
      .then((e) => {
        if (live) setEvents(e)
      })
      .catch(() => {
        if (live) setEvents([])
      })
    return () => {
      live = false
    }
    // `load` is a fresh closure on every render, so it cannot be a dependency without refetching
    // forever. The id it closes over is what actually varies, and each caller passes it as `key`,
    // so a different aggregate re-mounts the timeline rather than mutating it.
  }, [load])

  if (events === null) {
    return (
      <p className="flex items-center gap-2 px-3 py-6 text-sm text-muted-foreground">
        <Loader2Icon className="size-4 animate-spin" /> Geçmiş yükleniyor…
      </p>
    )
  }
  if (events.length === 0) {
    return <EmptyState icon={HistoryIcon} title="Kayıt yok" description={emptyLabel} />
  }

  const shown = kinds.length === 0 ? events : events.filter((e) => kinds.includes(e.kind))

  return (
    <div className="space-y-3">
      {filterable ? (
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <Button
              key={f.kind}
              size="sm"
              variant={kinds.includes(f.kind) ? 'default' : 'outline'}
              onClick={() =>
                setKinds((prev) =>
                  prev.includes(f.kind) ? prev.filter((k) => k !== f.kind) : [...prev, f.kind],
                )
              }
            >
              {f.label}
            </Button>
          ))}
          {kinds.length > 0 ? (
            <Button size="sm" variant="ghost" onClick={() => setKinds([])}>
              Temizle
            </Button>
          ) : null}
        </div>
      ) : null}

      <ActivityList events={shown} emptyLabel="Bu filtrede hareket yok." />
    </div>
  )
}
