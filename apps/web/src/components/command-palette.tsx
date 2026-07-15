'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  ChevronLeftIcon,
  CornerDownLeftIcon,
  CreditCardIcon,
  DoorOpenIcon,
  MessageCircleIcon,
  PlusIcon,
  SearchIcon,
  UserIcon,
} from 'lucide-react'

import type { PrincipalRole } from '@studio/core'

import { GROUPS } from '@/components/app-nav'
import { canSee } from '@/lib/permissions'
import { openWhatsApp, WA_TEMPLATES, isWhatsAppReachable } from '@/lib/whatsapp'
import { searchMembersAction, type MemberHit } from '@/server/actions/search'
import { cn } from '@/lib/utils'

// ⌘K — the operations command palette (Plus Phase 2 §1). One keystroke: find a member by name or
// phone and see, without opening anything, her package, credits, days left and the one status worth
// noticing — then act (open detail, book, check-in, WhatsApp, payments). Or jump to any screen the
// role may open. Navigation is drawn from the SAME GROUPS the rail uses and filtered by the SAME
// `canSee`, so it can never offer a door the role cannot pass. Every action goes through an existing
// route or trusted path — the palette allocates nothing itself.

type NavRow = { readonly kind: 'nav'; readonly href: string; readonly title: string; readonly sub: string }

export function CommandPalette({ role }: { role: PrincipalRole }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<readonly MemberHit[]>([])
  const [active, setActive] = useState(0)
  const [picked, setPicked] = useState<MemberHit | null>(null) // a member whose action menu is showing
  const inputRef = useRef<HTMLInputElement>(null)
  const reqId = useRef(0)

  // ⌘K / Ctrl+K toggles; "/" opens (Phase 2 §9) when not typing; a rail button dispatches an event.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      const typing = el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault()
        setOpen((v) => !v)
      } else if (e.key === '/' && !typing && !open) {
        e.preventDefault()
        setOpen(true)
      }
    }
    const openEv = () => setOpen(true)
    window.addEventListener('keydown', onKey)
    window.addEventListener('sos:open-command', openEv)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('sos:open-command', openEv)
    }
  }, [open])

  useEffect(() => {
    if (open) {
      setQuery('')
      setHits([])
      setActive(0)
      setPicked(null)
      const t = setTimeout(() => inputRef.current?.focus(), 20)
      return () => clearTimeout(t)
    }
    return undefined
  }, [open])

  // Debounced member search, race-guarded so a stale answer never overwrites a newer query.
  useEffect(() => {
    const q = query.trim()
    if (q.length < 2 || picked) {
      setHits([])
      return undefined
    }
    const id = ++reqId.current
    const t = setTimeout(async () => {
      const r = await searchMembersAction(q)
      if (id === reqId.current) setHits(r)
    }, 160)
    return () => clearTimeout(t)
  }, [query, picked])

  const navRows: readonly NavRow[] = useMemo(() => {
    const q = query.trim().toLowerCase()
    const all = GROUPS.flatMap((g) =>
      g.items
        .filter((it) => canSee(role, it.href))
        .map((it) => ({ kind: 'nav' as const, href: it.href, title: it.label, sub: g.label ?? 'Genel' })),
    )
    return q ? all.filter((r) => r.title.toLowerCase().includes(q)) : all
  }, [query, role])

  // Rows are members (rich) then navigation — unless a member is picked, when the actions take over.
  const memberRows = picked ? [] : hits
  const rows = picked ? [] : [...memberRows.map((m) => ({ t: 'm' as const, m })), ...navRows.map((n) => ({ t: 'n' as const, n }))]

  useEffect(() => {
    setActive((a) => (rows.length === 0 ? 0 : Math.min(a, rows.length - 1)))
  }, [rows.length])

  const close = useCallback(() => setOpen(false), [])
  const go = useCallback(
    (href: string) => {
      setOpen(false)
      router.push(href)
    },
    [router],
  )

  const choose = useCallback(
    (i: number) => {
      const row = rows[i]
      if (!row) return
      if (row.t === 'n') go(row.n.href)
      else {
        setPicked(row.m) // open the member's action menu
        setActive(0)
      }
    },
    [rows, go],
  )

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (picked) {
      if (e.key === 'Escape') {
        e.preventDefault()
        setPicked(null)
        setTimeout(() => inputRef.current?.focus(), 10)
      }
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => (rows.length ? (a + 1) % rows.length : 0))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => (rows.length ? (a - 1 + rows.length) % rows.length : 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      choose(active)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      close()
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center p-4 pt-[12vh]" role="dialog" aria-modal="true" aria-label="Komut paleti">
      <button aria-hidden tabIndex={-1} onClick={close} className="fixed inset-0 -z-10 cursor-default bg-foreground/25 backdrop-blur-sm" />
      <div className="w-full max-w-lg overflow-hidden rounded-xl border border-border bg-popover shadow-lg">
        {/* search row */}
        <div className="flex items-center gap-2.5 border-b border-border px-4">
          {picked ? (
            <button onClick={() => setPicked(null)} className="grid size-6 place-items-center rounded text-muted-foreground hover:text-foreground" aria-label="Geri">
              <ChevronLeftIcon className="size-4" />
            </button>
          ) : (
            <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
          )}
          <input
            ref={inputRef}
            value={picked ? picked.fullName : query}
            onChange={(e) => !picked && setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            readOnly={Boolean(picked)}
            placeholder="Üye ara veya bir ekrana git…"
            className="h-12 w-full bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground"
            aria-label="Ara"
          />
          <kbd className="hidden shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground sm:block">ESC</kbd>
        </div>

        {picked ? (
          <MemberActions member={picked} onGo={go} onClose={close} />
        ) : (
          <ul className="max-h-[52vh] overflow-y-auto p-1.5">
            {rows.length === 0 ? (
              <li className="px-3 py-6 text-center text-sm text-muted-foreground">
                {query.trim().length >= 2 ? 'Sonuç yok.' : 'Üye ara veya bir ekrana git.'}
              </li>
            ) : (
              rows.map((row, i) =>
                row.t === 'm' ? (
                  <MemberResult key={`m-${row.m.id}`} m={row.m} on={i === active} onMove={() => setActive(i)} onClick={() => choose(i)} />
                ) : (
                  <NavResult key={`n-${row.n.href}`} n={row.n} on={i === active} onMove={() => setActive(i)} onClick={() => choose(i)} />
                ),
              )
            )}
          </ul>
        )}

        <div className="flex items-center gap-3 border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1"><kbd className="rounded border border-border px-1">↑</kbd><kbd className="rounded border border-border px-1">↓</kbd> gez</span>
          <span className="flex items-center gap-1"><kbd className="rounded border border-border px-1">↵</kbd> seç</span>
          <span className="ml-auto flex items-center gap-1"><kbd className="rounded border border-border px-1">⌘</kbd><kbd className="rounded border border-border px-1">K</kbd></span>
        </div>
      </div>
    </div>
  )
}

function MemberResult({ m, on, onMove, onClick }: { m: MemberHit; on: boolean; onMove: () => void; onClick: () => void }) {
  return (
    <li>
      <button
        type="button"
        onMouseMove={onMove}
        onClick={onClick}
        className={cn('flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors', on ? 'bg-primary-soft text-primary' : 'text-foreground hover:bg-muted')}
      >
        <span className={cn('grid size-8 shrink-0 place-items-center rounded-full text-[0.72rem] font-semibold', on ? 'bg-primary text-primary-foreground' : 'bg-primary/10 text-primary')}>
          {m.fullName.slice(0, 2).toLocaleUpperCase('tr')}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{m.fullName}</span>
          <span className={cn('block truncate text-xs', on ? 'text-primary/70' : 'text-muted-foreground')}>
            {m.phone} · {m.packageLabel}
          </span>
        </span>
        {m.warn ? (
          <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[0.7rem] font-medium', on ? 'bg-primary/15 text-primary' : 'bg-warning/10 text-warning')}>{m.warn}</span>
        ) : null}
        {on ? <CornerDownLeftIcon className="size-3.5 shrink-0 opacity-70" /> : null}
      </button>
    </li>
  )
}

function NavResult({ n, on, onMove, onClick }: { n: NavRow; on: boolean; onMove: () => void; onClick: () => void }) {
  return (
    <li>
      <button
        type="button"
        onMouseMove={onMove}
        onClick={onClick}
        className={cn('flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors', on ? 'bg-primary-soft text-primary' : 'text-foreground hover:bg-muted')}
      >
        <span className={cn('grid size-8 shrink-0 place-items-center rounded-md text-[0.7rem] font-semibold', on ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground')}>›</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{n.title}</span>
          <span className={cn('block truncate text-xs', on ? 'text-primary/70' : 'text-muted-foreground')}>Git · {n.sub}</span>
        </span>
      </button>
    </li>
  )
}

function MemberActions({ member, onGo, onClose }: { member: MemberHit; onGo: (href: string) => void; onClose: () => void }) {
  const reachable = isWhatsAppReachable(member.phone)
  const actions = [
    { icon: UserIcon, label: 'Üye detayını aç', run: () => onGo(`/members/${member.id}`) },
    { icon: PlusIcon, label: 'Yeni rezervasyon', run: () => onGo(`/members/${member.id}`) }, // §2 hızlı rezervasyon buraya bağlanacak
    { icon: DoorOpenIcon, label: 'Check-in yap', run: () => onGo('/checkin') },
    {
      icon: MessageCircleIcon,
      label: reachable ? "WhatsApp'tan yaz" : 'WhatsApp — telefon yok',
      disabled: !reachable,
      run: () => {
        if (reachable) openWhatsApp(member.phone, WA_TEMPLATES.greeting(member.fullName))
        onClose()
      },
    },
    { icon: CreditCardIcon, label: 'Paket / ödeme durumu', run: () => onGo(`/members/${member.id}`) },
  ]
  return (
    <ul className="max-h-[52vh] overflow-y-auto p-1.5">
      <li className="px-3 py-1.5 text-xs text-muted-foreground">{member.packageLabel}{member.warn ? ` · ${member.warn}` : ''}</li>
      {actions.map((a) => (
        <li key={a.label}>
          <button
            type="button"
            disabled={a.disabled}
            onClick={a.run}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm text-foreground transition-colors hover:bg-primary-soft hover:text-primary disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-foreground"
          >
            <a.icon className="size-4 shrink-0 text-muted-foreground" />
            {a.label}
          </button>
        </li>
      ))}
    </ul>
  )
}
