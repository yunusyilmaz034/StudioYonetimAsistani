'use client'

import { useCallback, useEffect, useState, useTransition } from 'react'
import { Loader2Icon, RefreshCwIcon } from 'lucide-react'

import { useRouter, useSearchParams } from 'next/navigation'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PageHeader } from '@/components/ui/page-header'
import { ActivityList } from '@/components/activity/activity-row'
import { loadFeedAction, resolveSearchAction } from '@/server/actions/activity'
import type { ActivityEvent, ActivityKind, ActivityPage } from '@/server/activity-query'

import { RANGES, resolveRange, type RangeId } from '@/lib/ranges'

// The kind filters the owner asked for. QR is not a separate family: a QR check-in IS a check-in,
// and splitting it would file the same movement in two places.
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

export function ActivityScreen({ initial, isOwner }: { initial: ActivityPage; isOwner: boolean }) {
  const router = useRouter()
  const params = useSearchParams()

  // The filters live in the URL (owner, v1.23): a refresh reopens the same view, and a filtered feed
  // is a link reception can be sent. The URL is the state; React just mirrors it.
  const kinds = (params.get('kinds')?.split(',').filter(Boolean) ?? []) as readonly ActivityKind[]
  const range = (params.get('range') ?? 'all') as RangeId
  const memberId = params.get('memberId')
  const memberName = params.get('memberName')
  const member = memberId ? { id: memberId, name: memberName ?? '' } : null

  const [entries, setEntries] = useState<readonly ActivityEvent[]>(initial.entries)
  const [cursor, setCursor] = useState<string | null>(initial.nextCursor)
  const [query, setQuery] = useState('')
  const [notFound, setNotFound] = useState(false)
  const [pending, start] = useTransition()

  const setUrl = (next: {
    kinds?: readonly ActivityKind[]
    range?: RangeId
    member?: { id: string; name: string } | null
  }) => {
    const q = new URLSearchParams()
    const k = next.kinds ?? kinds
    const r = next.range ?? range
    const m = next.member === undefined ? member : next.member
    if (k.length > 0) q.set('kinds', k.join(','))
    if (r !== 'all') q.set('range', r)
    if (m) {
      q.set('memberId', m.id)
      if (m.name) q.set('memberName', m.name)
    }
    router.replace(q.size > 0 ? `/activity?${q.toString()}` : '/activity')
  }

  const load = useCallback(
    (cursorId: string | null, append: boolean) => {
      const r = resolveRange(range, Date.now())
      start(async () => {
        const page = await loadFeedAction({
          kinds,
          cursor: cursorId,
          ...(range === 'all' ? {} : { fromMs: r.fromMs, toMs: r.toMs }),
          ...(member ? { memberId: member.id } : {}),
        })
        setEntries((prev) => (append ? [...prev, ...page.entries] : page.entries))
        setCursor(page.nextCursor)
      })
    },
    // The URL string is the dependency, deliberately: it IS the filter state, and depending on the
    // parsed pieces would refetch on every render (they are new objects each time).
    [params],
  )

  // The URL changed ⇒ the feed reloads. One source of truth for what is on screen.
  useEffect(() => {
    load(null, false)
  }, [load])

  const toggle = (k: ActivityKind) => {
    setUrl({ kinds: kinds.includes(k) ? kinds.filter((x) => x !== k) : [...kinds, k] })
  }

  // D28 — search. A phone number never touches the log (there are none in it): it is resolved to a
  // memberId against /members first, and the log is then queried by that id.
  const search = () => {
    const q = query.trim()
    if (!q) return
    start(async () => {
      const hit = await resolveSearchAction({ query: q })
      setNotFound(hit.kind === 'none')
      if (hit.kind === 'operation' && hit.operationId) {
        // The operation detail is owner-only. Reception searching an İşlem No used to be pushed at a
        // door that threw her straight back to the dashboard — a search that silently did nothing
        // (Alpha Review). Now it tells her the truth.
        if (!isOwner) {
          toast.error('İşlem detayını yalnızca stüdyo sahibi görebilir.')
          return
        }
        router.push(`/operations/${hit.operationId}`)
        return
      }
      if (hit.kind === 'member' && hit.memberId) {
        setUrl({ member: { id: hit.memberId, name: hit.memberName ?? '' } })
      }
    })
  }

  const more = () => load(cursor, true)

  return (
    <main className="mx-auto max-w-3xl space-y-4 p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="Hareket Merkezi"
        description="Stüdyoda bugün ne olduysa, burada."
        actions={
          <Button variant="outline" onClick={() => load(null, false)} disabled={pending}>
            {pending ? <Loader2Icon className="animate-spin" /> : <RefreshCwIcon />}
            <span className="hidden sm:inline">Yenile</span>
          </Button>
        }
      />

      {/* Search: üye adı · telefon · İşlem No */}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          className="w-full sm:w-72"
          placeholder="Üye adı, telefon veya İşlem No…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setNotFound(false)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') search()
          }}
        />
        <Button variant="outline" size="sm" onClick={search} disabled={pending}>
          Ara
        </Button>
        {member ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setQuery('')
              setUrl({ member: null })
            }}
          >
            {member.name} · filtreyi kaldır
          </Button>
        ) : null}
        {notFound ? <span className="text-sm text-muted-foreground">Eşleşen kayıt bulunamadı.</span> : null}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {[{ id: 'all' as RangeId, label: 'Tümü' }, ...RANGES.filter((r) => r.id !== 'custom')].map((r) => (
          <Button
            key={r.id}
            size="sm"
            variant={range === r.id ? 'default' : 'outline'}
            onClick={() => setUrl({ range: r.id })}
          >
            {r.label}
          </Button>
        ))}
      </div>

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
          <Button size="sm" variant="ghost" onClick={() => setUrl({ kinds: [] })}>
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
