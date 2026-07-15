'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CornerDownLeftIcon, SearchIcon, UserIcon } from 'lucide-react'

import type { PrincipalRole } from '@studio/core'

import { GROUPS } from '@/components/app-nav'
import { canSee } from '@/lib/permissions'
import { searchMembersAction, type MemberHit } from '@/server/actions/search'
import { cn } from '@/lib/utils'

// ⌘K — the operations command palette (Plus Phase 2, Doc 32 §2: fast member search + keyboard-first
// navigation). One keystroke from anywhere: find a member by name or phone, or jump to any screen the
// role may see. Reception lives at speed, and this is the spine of it.
//
// Navigation is drawn from the SAME GROUPS the rail uses and filtered by the SAME `canSee` — a
// destination a role cannot open is never offered, and the two can never disagree. Member search is
// one light, debounced read (see `searchMembersAction`).

type Row =
  | { readonly kind: 'member'; readonly id: string; readonly title: string; readonly sub: string }
  | { readonly kind: 'nav'; readonly href: string; readonly title: string; readonly sub: string }

export function CommandPalette({ role }: { role: PrincipalRole }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<readonly MemberHit[]>([])
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const reqId = useRef(0)

  // ⌘K / Ctrl+K toggles; the shortcut belongs to the app, so it is caught in the capture phase and
  // does not fight a focused input.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault()
        setOpen((v) => !v)
      }
    }
    // A visible trigger (the rail's "Ara") opens it too, via a custom event — so discovery does not
    // depend on knowing the shortcut.
    const openEv = () => setOpen(true)
    window.addEventListener('keydown', onKey)
    window.addEventListener('sos:open-command', openEv)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('sos:open-command', openEv)
    }
  }, [])

  // Reset and focus on open.
  useEffect(() => {
    if (open) {
      setQuery('')
      setHits([])
      setActive(0)
      const t = setTimeout(() => inputRef.current?.focus(), 20)
      return () => clearTimeout(t)
    }
    return undefined
  }, [open])

  // Debounced member search. A monotonically-increasing request id drops any answer that arrives
  // after a newer keystroke, so results never flicker back to a stale query.
  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) {
      setHits([])
      return undefined
    }
    const id = ++reqId.current
    const t = setTimeout(async () => {
      const r = await searchMembersAction(q)
      if (id === reqId.current) setHits(r)
    }, 160)
    return () => clearTimeout(t)
  }, [query])

  const navRows: readonly Row[] = useMemo(() => {
    const q = query.trim().toLowerCase()
    const all = GROUPS.flatMap((g) =>
      g.items
        .filter((it) => canSee(role, it.href))
        .map((it) => ({ kind: 'nav' as const, href: it.href, title: it.label, sub: g.label ?? 'Genel' })),
    )
    return q ? all.filter((r) => r.title.toLowerCase().includes(q)) : all
  }, [query, role])

  const rows: readonly Row[] = useMemo(
    () => [
      ...hits.map((h) => ({ kind: 'member' as const, id: h.id, title: h.fullName, sub: h.phone })),
      ...navRows,
    ],
    [hits, navRows],
  )

  // Keep the active index in range as the row set changes.
  useEffect(() => {
    setActive((a) => (rows.length === 0 ? 0 : Math.min(a, rows.length - 1)))
  }, [rows.length])

  const choose = useCallback(
    (row: Row | undefined) => {
      if (!row) return
      setOpen(false)
      router.push(row.kind === 'member' ? `/members/${row.id}` : row.href)
    },
    [router],
  )

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => (rows.length ? (a + 1) % rows.length : 0))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => (rows.length ? (a - 1 + rows.length) % rows.length : 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      choose(rows[active])
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
    }
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center p-4 pt-[12vh]"
      role="dialog"
      aria-modal="true"
      aria-label="Komut paleti"
    >
      {/* backdrop */}
      <button
        aria-hidden
        tabIndex={-1}
        onClick={() => setOpen(false)}
        className="fixed inset-0 -z-10 cursor-default bg-foreground/25 backdrop-blur-sm"
      />
      <div className="w-full max-w-lg overflow-hidden rounded-xl border border-border bg-popover shadow-lg">
        <div className="flex items-center gap-2.5 border-b border-border px-4">
          <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Üye ara veya bir ekrana git…"
            className="h-12 w-full bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground"
            aria-label="Ara"
          />
          <kbd className="hidden shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground sm:block">
            ESC
          </kbd>
        </div>

        <ul className="max-h-[52vh] overflow-y-auto p-1.5">
          {rows.length === 0 ? (
            <li className="px-3 py-6 text-center text-sm text-muted-foreground">
              {query.trim().length >= 2 ? 'Sonuç yok.' : 'Aramak için yazmaya başla.'}
            </li>
          ) : (
            rows.map((row, i) => {
              const key = row.kind === 'member' ? `m-${row.id}` : `n-${row.href}`
              const on = i === active
              return (
                <li key={key}>
                  <button
                    type="button"
                    onMouseMove={() => setActive(i)}
                    onClick={() => choose(row)}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors',
                      on ? 'bg-primary-soft text-primary' : 'text-foreground hover:bg-muted',
                    )}
                  >
                    <span
                      className={cn(
                        'grid size-7 shrink-0 place-items-center rounded-md',
                        row.kind === 'member' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground',
                      )}
                    >
                      <UserIcon className={cn('size-3.5', row.kind === 'nav' && 'hidden')} />
                      {row.kind === 'nav' ? <span className="text-[0.7rem] font-semibold">›</span> : null}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{row.title}</span>
                      <span className={cn('block truncate text-xs', on ? 'text-primary/70' : 'text-muted-foreground')}>
                        {row.kind === 'member' ? row.sub : `Git · ${row.sub}`}
                      </span>
                    </span>
                    {on ? <CornerDownLeftIcon className="size-3.5 shrink-0 opacity-70" /> : null}
                  </button>
                </li>
              )
            })
          )}
        </ul>

        <div className="flex items-center gap-3 border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <kbd className="rounded border border-border px-1">↑</kbd>
            <kbd className="rounded border border-border px-1">↓</kbd> gez
          </span>
          <span className="flex items-center gap-1">
            <kbd className="rounded border border-border px-1">↵</kbd> aç
          </span>
          <span className="ml-auto flex items-center gap-1">
            <kbd className="rounded border border-border px-1">⌘</kbd>
            <kbd className="rounded border border-border px-1">K</kbd>
          </span>
        </div>
      </div>
    </div>
  )
}
