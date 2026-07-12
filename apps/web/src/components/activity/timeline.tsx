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

// D27 — the package's life, as a strip. The stages a package can pass through are fixed; the strip
// lights up the ones this package has actually seen, so a member's question ("neden kredim düştü?")
// is answered by a shape before it is answered by a list.
const LIFECYCLE: readonly { key: string; label: string; types: readonly string[] }[] = [
  { key: 'purchased', label: 'Satın alındı', types: ['entitlement.purchased'] },
  { key: 'held', label: 'Kredi ayrıldı', types: ['entitlement.credit_held'] },
  { key: 'consumed', label: 'Kredi kullanıldı', types: ['entitlement.credit_consumed'] },
  { key: 'released', label: 'Kredi iade', types: ['entitlement.credit_released', 'entitlement.credit_restored'] },
  { key: 'extended', label: 'Uzatıldı', types: ['entitlement.extended', 'entitlement.adjusted'] },
  { key: 'frozen', label: 'Donduruldu', types: ['entitlement.frozen'] },
  { key: 'expired', label: 'Süresi doldu', types: ['entitlement.expired', 'entitlement.exhausted'] },
  { key: 'cancelled', label: 'İptal', types: ['entitlement.cancelled'] },
]

export function PackageLifecycle({ events }: { events: readonly ActivityEvent[] }) {
  const seen = new Set(events.map((e) => e.type))
  return (
    <ol className="flex flex-wrap gap-1.5">
      {LIFECYCLE.map((stage) => {
        const reached = stage.types.some((t) => seen.has(t))
        const count = events.filter((e) => stage.types.includes(e.type)).length
        return (
          <li
            key={stage.key}
            className={`rounded-md px-2 py-0.5 text-[0.6875rem] font-medium ${
              reached ? 'bg-primary-soft text-primary' : 'bg-muted text-muted-foreground/60'
            }`}
          >
            {stage.label}
            {reached && count > 1 ? ` ×${count}` : ''}
          </li>
        )
      })}
    </ol>
  )
}

export function Timeline({
  load,
  filterable = false,
  lifecycle = false,
  emptyLabel = 'Henüz kayıt yok.',
}: {
  load: () => Promise<readonly ActivityEvent[]>
  filterable?: boolean
  lifecycle?: boolean // D27 — show the package lifecycle strip above the list
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
      {lifecycle ? <PackageLifecycle events={events} /> : null}
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
