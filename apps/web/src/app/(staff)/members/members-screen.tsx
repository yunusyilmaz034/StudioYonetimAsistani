'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { PlusIcon, SearchIcon, UsersIcon } from 'lucide-react'


import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { PageHeader } from '@/components/ui/page-header'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { FILTERS, matches, type MemberBadges, type MemberFilter } from '@/lib/members/filters'
import type { MemberRow } from '@/server/members-query'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

import { MemberForm } from './member-form'

const STATUS_LABEL: Record<string, string> = {
  active: 'Aktif',
  inactive: 'Pasif',
  deleted: 'Silindi',
}

const PAGE_SIZE = 10

// The page numbers to draw: all of them when there are few, otherwise a window around the current one
// with gaps — 1 … 4 5 [6] 7 8 … 20.
function pageWindow(current: number, total: number): (number | 'gap')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const pages: (number | 'gap')[] = [1]
  const start = Math.max(2, current - 1)
  const end = Math.min(total - 1, current + 1)
  if (start > 2) pages.push('gap')
  for (let p = start; p <= end; p++) pages.push(p)
  if (end < total - 1) pages.push('gap')
  pages.push(total)
  return pages
}

export function MembersScreen({
  members,
  defaultBranchId,
  initialCreate = false,
}: {
  members: readonly MemberRow[]
  defaultBranchId: string | null
  initialCreate?: boolean
}) {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<MemberFilter>('all')
  const [formOpen, setFormOpen] = useState(false)
  const [page, setPage] = useState(1)
  const [showAll, setShowAll] = useState(false)

  // Quick action (?new=1) — open the create form once on mount.
  const opened = useRef(false)
  useEffect(() => {
    if (opened.current) return
    opened.current = true
    if (initialCreate) setFormOpen(true)
  }, [initialCreate])

  // Search AND filter — they compose. "Bitecek paketi olanlar arasında Ayşe hangisiydi?" is one
  // question, not two screens.
  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase('tr')
    const digits = query.replace(/\D/g, '')
    return members.filter((m) => {
      if (!matches(filter, m.badges)) return false
      if (!q && !digits) return true
      return (
        m.fullName.toLocaleLowerCase('tr').includes(q) ||
        (digits.length > 0 && m.phoneNormalized.includes(digits))
      )
    })
  }, [members, query, filter])

  // Paginate the (already filtered) list to 10 a page. Reset to page 1 whenever the search or filter
  // changes so a narrowing search never strands you on an empty page 7; `currentPage` clamps to range.
  useEffect(() => {
    setPage(1)
  }, [query, filter])
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const currentPage = Math.min(page, pageCount)
  const pageItems = showAll ? filtered : filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)

  // The count on each chip is the point of the chip. "Bitecek" is a word; "Bitecek 4" is a morning's
  // work — and a zero tells her, truthfully, that there is nothing to do there today.
  const counts = useMemo(
    () =>
      Object.fromEntries(
        FILTERS.map((f) => [f.id, members.filter((m) => matches(f.id, m.badges)).length]),
      ) as Record<MemberFilter, number>,
    [members],
  )

  function open(m: MemberRow) {
    router.push(`/members/${m.id}`)
  }
  function onFormDone() {
    setFormOpen(false)
    router.refresh()
  }

  const searching = query.trim().length > 0

  return (
    <main className="mx-auto max-w-4xl space-y-4 p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="Üyeler"
        description={`${members.length} üye`}
        actions={
          <Button className="min-h-11 sm:min-h-0" onClick={() => setFormOpen(true)}>
            <PlusIcon />
            Yeni Üye
          </Button>
        }
      />

      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <SearchIcon className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="İsim veya telefon ara…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        {searching ? (
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
            {filtered.length} / {members.length}
          </span>
        ) : null}
      </div>

      {/* The filters (v1.27 S7). Search answers a question you already know the answer to — "where is
          Ayşe?". These answer the ones reception actually has at 09:00, and none of them can be typed
          into a search box. A chip with a zero stays visible: it is the answer "nobody", and that is
          worth knowing. */}
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFilter(f.id)}
            className={`min-h-9 rounded-full border px-3 text-xs transition-colors ${
              f.id === filter
                ? 'border-primary bg-primary-soft font-medium text-primary'
                : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground'
            }`}
          >
            {f.label}
            <span className="ml-1.5 tabular-nums opacity-70">{counts[f.id]}</span>
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={UsersIcon}
          title={query ? 'Eşleşen üye yok' : 'Henüz üye yok'}
          description={query ? 'Aramayı değiştirin.' : 'İlk üyeyi ekleyin.'}
          action={
            query ? undefined : (
              <Button onClick={() => setFormOpen(true)}>
                <PlusIcon />
                Yeni Üye
              </Button>
            )
          }
        />
      ) : (
        <>
          {/* Mobile: one card, rows inside — not a stack of boxes (Doc 09 §9). */}
          <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card shadow-sm md:hidden">
            {pageItems.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => open(m)}
                className="flex w-full items-center justify-between gap-3 px-3 py-3 text-left transition-colors hover:bg-primary-soft/40"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{m.fullName}</p>
                  <p className="truncate text-xs tabular-nums text-muted-foreground">{m.phone}</p>
                </div>
                <MemberBadgeCell status={m.status} badges={m.badges} />
              </button>
            ))}
          </div>

          {/* Desktop: table on one surface. */}
          <div className="hidden overflow-hidden rounded-xl border border-border bg-card shadow-sm md:block">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30 hover:bg-muted/30">
                  <TableHead className="px-4 text-[0.6875rem] font-medium tracking-wide uppercase text-muted-foreground">
                    Ad Soyad
                  </TableHead>
                  <TableHead className="px-4 text-[0.6875rem] font-medium tracking-wide uppercase text-muted-foreground">
                    Telefon
                  </TableHead>
                  <TableHead className="w-32 px-4 text-[0.6875rem] font-medium tracking-wide whitespace-nowrap uppercase text-muted-foreground">
                    Durum
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pageItems.map((m) => (
                  <TableRow
                    key={m.id}
                    onClick={() => open(m)}
                    className="cursor-pointer transition-colors hover:bg-primary-soft/40"
                  >
                    <TableCell className="px-4 py-3 font-medium text-foreground">{m.fullName}</TableCell>
                    <TableCell className="px-4 py-3 tabular-nums text-muted-foreground">{m.phone}</TableCell>
                    <TableCell className="w-32 px-4 py-3 whitespace-nowrap">
                      <MemberBadgeCell status={m.status} badges={m.badges} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Range + numbered pagination + "show all" toggle — only when the list overflows a page. */}
          {filtered.length > PAGE_SIZE ? (
            <div className="flex flex-col items-center gap-2 pt-1 sm:flex-row sm:justify-between">
              <span className="text-xs tabular-nums text-muted-foreground">
                {showAll
                  ? `${filtered.length} üye`
                  : `${(currentPage - 1) * PAGE_SIZE + 1}–${Math.min(currentPage * PAGE_SIZE, filtered.length)} / ${filtered.length}`}
              </span>
              {!showAll && pageCount > 1 ? (
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="sm" className="min-w-9" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>
                    ‹
                  </Button>
                  {pageWindow(currentPage, pageCount).map((p, i) =>
                    p === 'gap' ? (
                      <span key={`gap-${i}`} className="px-1 text-xs text-muted-foreground">
                        …
                      </span>
                    ) : (
                      <Button
                        key={p}
                        variant={p === currentPage ? 'default' : 'ghost'}
                        size="sm"
                        className="min-w-9 tabular-nums"
                        onClick={() => setPage(p)}
                      >
                        {p}
                      </Button>
                    ),
                  )}
                  <Button variant="ghost" size="sm" className="min-w-9" disabled={currentPage === pageCount} onClick={() => setPage(currentPage + 1)}>
                    ›
                  </Button>
                </div>
              ) : null}
              <Button
                variant="ghost"
                size="sm"
                className="text-primary"
                onClick={() => {
                  setShowAll((v) => !v)
                  setPage(1)
                }}
              >
                {showAll ? 'Sayfalı göster' : 'Tümünü göster'}
              </Button>
            </div>
          ) : null}
        </>
      )}

      {/* Create */}
      <Sheet open={formOpen} onOpenChange={setFormOpen}>
        <SheetContent side="right" className="gap-4 overflow-y-auto p-4 sm:p-5">
          <SheetHeader className="p-0">
            <SheetTitle className="text-h1">Yeni Üye</SheetTitle>
            <SheetDescription>Zorunlu alanlar: ad soyad ve telefon.</SheetDescription>
          </SheetHeader>
          <MemberForm member={null} defaultBranchId={defaultBranchId} onDone={onFormDone} />
        </SheetContent>
      </Sheet>
    </main>
  )
}

// Quiet by default, loud only when abnormal (Doc 20 §1): a member with a healthy package is the norm
// and gets a plain caption. ONE badge, never a row of them — a list where every row shouts is a list
// where nothing does. The order below is the order of what reception should act on first.
function MemberBadgeCell({ status, badges }: { status: string; badges: MemberBadges }) {
  if (status !== 'active') {
    return (
      <Badge className={status === 'deleted' ? 'bg-danger/10 text-danger' : 'bg-muted text-muted-foreground'}>
        {STATUS_LABEL[status] ?? status}
      </Badge>
    )
  }
  if (badges.inDebt) return <Badge className="bg-danger/10 text-danger">Borçlu</Badge>
  if (badges.frozen) return <Badge className="bg-muted text-muted-foreground">Donmuş</Badge>
  if (badges.expiring) return <Badge className="bg-warning/10 text-warning">Bitecek</Badge>
  if (badges.lowCredits) return <Badge className="bg-warning/10 text-warning">Kredi az</Badge>
  if (badges.noPackage) return <Badge className="bg-muted text-muted-foreground">Paketsiz</Badge>
  return <span className="text-xs text-muted-foreground">Aktif</span>
}
