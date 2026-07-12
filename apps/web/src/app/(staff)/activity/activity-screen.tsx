'use client'

import { useState, useTransition } from 'react'
import { Loader2Icon, RefreshCwIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/ui/page-header'
import { ActivityList } from '@/components/activity/activity-row'
import { loadFeedAction } from '@/server/actions/activity'
import type { ActivityEvent, ActivityKind, ActivityPage } from '@/server/activity-query'

// The filters the owner asked for. QR is not a separate event family — a QR check-in IS a
// check-in, and splitting it would put the same movement in two places. It reads under Check-in,
// where the door is.
const FILTERS: readonly { kind: ActivityKind; label: string }[] = [
  { kind: 'reservation', label: 'Rezervasyonlar' },
  { kind: 'membership', label: 'Üyelikler' },
  { kind: 'payment', label: 'Ödemeler' },
  { kind: 'credit', label: 'Krediler' },
  { kind: 'operation', label: 'Toplu İşlemler' },
  { kind: 'checkin', label: 'Check-in' },
  { kind: 'schedule', label: 'Program' },
  { kind: 'system', label: 'Sistem' },
]

export function ActivityScreen({ initial }: { initial: ActivityPage }) {
  const [entries, setEntries] = useState<readonly ActivityEvent[]>(initial.entries)
  const [cursor, setCursor] = useState<string | null>(initial.nextCursor)
  const [kinds, setKinds] = useState<readonly ActivityKind[]>([])
  const [pending, start] = useTransition()

  const reload = (next: readonly ActivityKind[]) => {
    start(async () => {
      const page = await loadFeedAction({ kinds: next, cursor: null })
      setEntries(page.entries)
      setCursor(page.nextCursor)
    })
  }

  const toggle = (k: ActivityKind) => {
    const next = kinds.includes(k) ? kinds.filter((x) => x !== k) : [...kinds, k]
    setKinds(next)
    reload(next)
  }

  const more = () => {
    start(async () => {
      const page = await loadFeedAction({ kinds, cursor })
      setEntries((prev) => [...prev, ...page.entries])
      setCursor(page.nextCursor)
    })
  }

  return (
    <main className="mx-auto max-w-3xl space-y-4 p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="Hareket Merkezi"
        description="Stüdyoda bugün ne olduysa, burada."
        actions={
          <Button variant="outline" onClick={() => reload(kinds)} disabled={pending}>
            {pending ? <Loader2Icon className="animate-spin" /> : <RefreshCwIcon />}
            <span className="hidden sm:inline">Yenile</span>
          </Button>
        }
      />

      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <Button
            key={f.kind}
            size="sm"
            variant={kinds.includes(f.kind) ? 'default' : 'outline'}
            onClick={() => toggle(f.kind)}
          >
            {f.label}
          </Button>
        ))}
        {kinds.length > 0 ? (
          <Button size="sm" variant="ghost" onClick={() => { setKinds([]); reload([]) }}>
            Temizle
          </Button>
        ) : null}
      </div>

      <ActivityList events={entries} emptyLabel="Bu filtrede hareket yok." />

      {cursor ? (
        <Button variant="outline" className="w-full" onClick={more} disabled={pending}>
          {pending ? <Loader2Icon className="animate-spin" /> : null}
          Daha eski hareketler
        </Button>
      ) : null}
    </main>
  )
}
